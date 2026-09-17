/*
 * Forensic asset exporter for recovered Macromedia Director movies.
 *
 * Compile against the LibreShockwave Java SDK. Bitmap decoding follows the
 * MIT-licensed bmdragos/shockwave-extractor approach. The Director 6+ sndH /
 * sndS pairing is handled explicitly because the SDK's snd parent is empty.
 */

import com.libreshockwave.DirectorFile;
import com.libreshockwave.bitmap.BitmapDecoder;
import com.libreshockwave.cast.BitmapInfo;
import com.libreshockwave.chunks.BitmapChunk;
import com.libreshockwave.chunks.CastMemberChunk;
import com.libreshockwave.chunks.Chunk;
import com.libreshockwave.chunks.MediaChunk;
import com.libreshockwave.chunks.PaletteChunk;
import com.libreshockwave.chunks.RawChunk;
import com.libreshockwave.chunks.SoundChunk;
import com.libreshockwave.chunks.TextChunk;
import com.libreshockwave.audio.SoundConverter;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class DirectorAssetExtractor {
    private record SoundFormat(int size, int frameRate, int bitsPerSample,
                               int channels, String compression) {}

    private static String clean(String value) {
        String normalized = value == null ? "" : value.trim();
        normalized = normalized.replaceAll("[^a-zA-Z0-9._-]+", "_");
        return normalized.isEmpty() ? "unnamed" : normalized;
    }

    private static String stem(CastMemberChunk member) {
        return String.format(Locale.ROOT, "%05d_%s", member.id(), clean(member.name()));
    }

    private static String cell(String value) {
        return value == null ? "" : value.replace('\t', ' ').replace('\r', ' ').replace('\n', ' ');
    }

    private static void addManifest(List<String> manifest, CastMemberChunk member,
                                    String chunkId, String fourcc, Path output,
                                    Path asset) {
        manifest.add(member.id() + "\t" + member.memberType() + "\t" + cell(member.name()) +
            "\t" + member.scriptId() + "\t" + chunkId + "\t" + cell(fourcc) + "\t" +
            output.relativize(asset).toString().replace('\\', '/'));
    }

    private static BufferedImage decodeBitmap(DirectorFile file, CastMemberChunk member)
            throws Exception {
        BitmapInfo info = BitmapInfo.parse(member.specificData());
        if (info.bitDepth() != 16) {
            return file.decodeBitmap(member).orElseThrow().toBufferedImage();
        }

        BitmapChunk bitmapChunk = null;
        for (var entry : file.getKeyTable().getEntriesForOwner(member.id())) {
            if (entry.fourccString().equals("BITD") && file.getChunk(entry.sectionId()) instanceof BitmapChunk found) {
                bitmapChunk = found;
                break;
            }
        }
        if (bitmapChunk == null) {
            throw new IllegalStateException("missing BITD chunk");
        }

        int width = info.width();
        int height = info.height();
        int scanWidth = BitmapDecoder.calculateScanWidth(width, 16);
        byte[] data = BitmapDecoder.decompressRLE(bitmapChunk.data(), scanWidth * height);
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < height; y++) {
            int row = y * scanWidth;
            for (int x = 0; x < width; x++) {
                int highIndex = row + x;
                int lowIndex = row + width + x;
                if (lowIndex >= data.length) {
                    continue;
                }
                int pixel = ((data[highIndex] & 0xff) << 8) | (data[lowIndex] & 0xff);
                int red = ((pixel >> 10) & 0x1f) * 255 / 31;
                int green = ((pixel >> 5) & 0x1f) * 255 / 31;
                int blue = (pixel & 0x1f) * 255 / 31;
                int alpha = pixel == 0x7fff ? 0 : 255;
                image.setRGB(x, y, (alpha << 24) | (red << 16) | (green << 8) | blue);
            }
        }
        return image;
    }

    private static byte[] rawBytes(Chunk chunk) {
        if (chunk instanceof RawChunk raw) {
            return raw.data();
        }
        if (chunk instanceof BitmapChunk bitmap) {
            return bitmap.data();
        }
        if (chunk instanceof SoundChunk sound) {
            return sound.audioData();
        }
        if (chunk instanceof MediaChunk media) {
            return media.audioData();
        }
        if (chunk instanceof TextChunk text) {
            return text.text().getBytes(StandardCharsets.UTF_8);
        }
        return null;
    }

    private static SoundFormat parseSoundHeader(byte[] header) {
        if (header.length < 84) {
            throw new IllegalArgumentException("sndH is shorter than 84 bytes");
        }
        ByteBuffer data = ByteBuffer.wrap(header).order(ByteOrder.BIG_ENDIAN);
        int size = data.getInt(4);
        int frameRate = data.getInt(44);
        byte[] compressionBytes = new byte[16];
        data.position(52);
        data.get(compressionBytes);
        String compression = new String(compressionBytes, StandardCharsets.ISO_8859_1)
            .replace("\0", "").trim();
        int bitsPerSample = data.getInt(68);
        int channels = data.getInt(76);
        return new SoundFormat(size, frameRate, bitsPerSample, channels, compression);
    }

    private static void writeLittle16(DataOutputStream output, int value) throws Exception {
        output.writeByte(value & 0xff);
        output.writeByte((value >>> 8) & 0xff);
    }

    private static void writeLittle32(DataOutputStream output, long value) throws Exception {
        output.writeByte((int) value & 0xff);
        output.writeByte((int) (value >>> 8) & 0xff);
        output.writeByte((int) (value >>> 16) & 0xff);
        output.writeByte((int) (value >>> 24) & 0xff);
    }

    private static byte[] wavFromSndPair(byte[] header, byte[] samples) throws Exception {
        SoundFormat format = parseSoundHeader(header);
        if (!format.compression().isEmpty()) {
            throw new IllegalArgumentException("compressed sndH/sndS audio: " + format.compression());
        }
        if (format.channels() < 1 || format.channels() > 2 ||
            (format.bitsPerSample() != 8 && format.bitsPerSample() != 16)) {
            throw new IllegalArgumentException("unsupported PCM format: " + format);
        }
        int sampleLength = format.size() > 0 ? Math.min(format.size(), samples.length) : samples.length;
        byte[] pcm = new byte[sampleLength];
        System.arraycopy(samples, 0, pcm, 0, sampleLength);
        if (format.bitsPerSample() == 16) {
            for (int offset = 0; offset + 1 < pcm.length; offset += 2) {
                byte high = pcm[offset];
                pcm[offset] = pcm[offset + 1];
                pcm[offset + 1] = high;
            }
        }

        int blockAlign = format.channels() * format.bitsPerSample() / 8;
        long byteRate = (long) format.frameRate() * blockAlign;
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(44 + pcm.length);
        DataOutputStream output = new DataOutputStream(bytes);
        output.writeBytes("RIFF");
        writeLittle32(output, 36L + pcm.length);
        output.writeBytes("WAVEfmt ");
        writeLittle32(output, 16);
        writeLittle16(output, 1);
        writeLittle16(output, format.channels());
        writeLittle32(output, format.frameRate());
        writeLittle32(output, byteRate);
        writeLittle16(output, blockAlign);
        writeLittle16(output, format.bitsPerSample());
        output.writeBytes("data");
        writeLittle32(output, pcm.length);
        output.write(pcm);
        return bytes.toByteArray();
    }

    private static void writeFileInfo(DirectorFile file, Path input, Path output) throws Exception {
        String info = "source\t" + input + "\n" +
            "afterburner\t" + file.isAfterburner() + "\n" +
            "version\t" + file.getVersion() + "\n" +
            "movie_type\t" + file.getMovieType() + "\n" +
            "stage_width\t" + file.getStageWidth() + "\n" +
            "stage_height\t" + file.getStageHeight() + "\n" +
            "tempo\t" + file.getTempo() + "\n" +
            "cast_members\t" + file.getCastMembers().size() + "\n" +
            "scripts\t" + file.getScripts().size() + "\n" +
            "palettes\t" + file.getPalettes().size() + "\n";
        Files.writeString(output.resolve("file_info.tsv"), info);
    }

    private static int exportSounds(DirectorFile file, CastMemberChunk member, Path output,
                                    List<String> manifest) throws Exception {
        byte[] sndHeader = null;
        byte[] sndSamples = null;
        Integer sndHeaderId = null;
        Integer sndSamplesId = null;
        int count = 0;
        for (var entry : file.getKeyTable().getEntriesForOwner(member.id())) {
            Chunk chunk = file.getChunk(entry.sectionId());
            String fourcc = entry.fourccString();
            byte[] raw = rawBytes(chunk);
            if (fourcc.equals("sndH")) {
                sndHeader = raw;
                sndHeaderId = entry.sectionId();
            } else if (fourcc.equals("sndS")) {
                sndSamples = raw;
                sndSamplesId = entry.sectionId();
            } else if (chunk instanceof MediaChunk media && media.audioData().length > 0) {
                SoundChunk sound = media.toSoundChunk();
                String extension = sound.isMp3() ? ".mp3" : ".wav";
                byte[] audio = sound.isMp3() ? SoundConverter.extractMp3(sound) : SoundConverter.toWav(sound);
                Path asset = output.resolve("sounds").resolve(stem(member) + "_" + entry.sectionId() + extension);
                Files.write(asset, audio);
                addManifest(manifest, member, Integer.toString(entry.sectionId()), fourcc, output, asset);
                count++;
            } else if (chunk instanceof SoundChunk sound && sound.audioData().length > 0) {
                String extension = sound.isMp3() ? ".mp3" : ".wav";
                byte[] audio = sound.isMp3() ? SoundConverter.extractMp3(sound) : SoundConverter.toWav(sound);
                Path asset = output.resolve("sounds").resolve(stem(member) + "_" + entry.sectionId() + extension);
                Files.write(asset, audio);
                addManifest(manifest, member, Integer.toString(entry.sectionId()), fourcc, output, asset);
                count++;
            }
        }
        if (sndHeader != null && sndSamples != null) {
            Path asset = output.resolve("sounds").resolve(stem(member) + "_" + sndSamplesId + ".wav");
            Files.write(asset, wavFromSndPair(sndHeader, sndSamples));
            addManifest(manifest, member, sndHeaderId + "+" + sndSamplesId, "sndH+sndS", output, asset);
            count++;
        }
        return count;
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            System.err.println("usage: DirectorAssetExtractor <movie.dir> <output-dir>");
            System.exit(2);
        }
        Path input = Path.of(args[0]);
        Path output = Path.of(args[1]);
        for (String directory : List.of("bitmaps", "sounds", "text", "raw_chunks", "palettes")) {
            Files.createDirectories(output.resolve(directory));
        }

        DirectorFile file = DirectorFile.load(input);
        file.setBasePath(input.getParent().toString());
        writeFileInfo(file, input, output);
        List<String> manifest = new ArrayList<>();
        manifest.add("member_id\tmember_type\tmember_name\tscript_id\tchunk_id\tfourcc\tasset_path");
        List<String> errors = new ArrayList<>();
        int bitmapCount = 0;
        int soundCount = 0;
        int textCount = 0;
        int rawCount = 0;

        for (CastMemberChunk member : file.getCastMembers()) {
            try {
                if (member.isBitmap()) {
                    Path asset = output.resolve("bitmaps").resolve(stem(member) + ".png");
                    ImageIO.write(decodeBitmap(file, member), "PNG", asset.toFile());
                    addManifest(manifest, member, "", "BITD", output, asset);
                    bitmapCount++;
                }
            } catch (Exception error) {
                errors.add(member.id() + "\tbitmap\t" + cell(error.toString()));
            }

            try {
                if (member.isSound()) {
                    soundCount += exportSounds(file, member, output, manifest);
                }
            } catch (Exception error) {
                errors.add(member.id() + "\tsound\t" + cell(error.toString()));
            }

            try {
                for (var entry : file.getKeyTable().getEntriesForOwner(member.id())) {
                    Chunk chunk = file.getChunk(entry.sectionId());
                    if (chunk instanceof TextChunk text) {
                        Path asset = output.resolve("text").resolve(
                            stem(member) + "_" + entry.sectionId() + ".txt");
                        Files.writeString(asset, text.text());
                        addManifest(manifest, member, Integer.toString(entry.sectionId()),
                            entry.fourccString(), output, asset);
                        textCount++;
                    }
                    byte[] raw = rawBytes(chunk);
                    if (raw != null && raw.length > 0) {
                        Path asset = output.resolve("raw_chunks").resolve(
                            stem(member) + "_" + entry.sectionId() + "_" +
                            clean(entry.fourccString()) + ".bin");
                        Files.write(asset, raw);
                        addManifest(manifest, member, Integer.toString(entry.sectionId()),
                            entry.fourccString(), output, asset);
                        rawCount++;
                    }
                }
                if (member.specificData().length > 0) {
                    Path asset = output.resolve("raw_chunks").resolve(stem(member) + "_CASt-specific.bin");
                    Files.write(asset, member.specificData());
                    addManifest(manifest, member, Integer.toString(member.id()), "CASt-specific", output, asset);
                    rawCount++;
                }
            } catch (Exception error) {
                errors.add(member.id() + "\traw-or-text\t" + cell(error.toString()));
            }
        }

        for (PaletteChunk palette : file.getPalettes()) {
            StringBuilder text = new StringBuilder("index\tr\tg\tb\thex\n");
            for (int index = 0; index < palette.colorCount(); index++) {
                int color = palette.getColor(index);
                text.append(index).append('\t').append((color >> 16) & 0xff).append('\t')
                    .append((color >> 8) & 0xff).append('\t').append(color & 0xff).append('\t')
                    .append(String.format(Locale.ROOT, "#%06X", color & 0xffffff)).append('\n');
            }
            Files.writeString(output.resolve("palettes/palette_" + palette.id() + ".tsv"), text);
        }

        Files.write(output.resolve("manifest.tsv"), manifest, StandardCharsets.UTF_8);
        if (!errors.isEmpty()) {
            errors.add(0, "member_id\tphase\terror");
            Files.write(output.resolve("errors.tsv"), errors, StandardCharsets.UTF_8);
        }
        System.out.printf(Locale.ROOT,
            "%s: members=%d bitmaps=%d sounds=%d text=%d raw=%d palettes=%d errors=%d%n",
            input.getFileName(), file.getCastMembers().size(), bitmapCount, soundCount,
            textCount, rawCount, file.getPalettes().size(), errors.size());
    }
}
