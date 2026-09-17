"""Regression tests for the original goMU loader -> native adapter handoff."""
import tempfile
import unittest
from pathlib import Path
from prepare_director_movies import patch_gomu_startup

ROOT = Path(__file__).resolve().parents[1]

class GoMuStartupTests(unittest.TestCase):
    def test_recovered_movie_changes_only_the_loader_call_operand(self):
        for movie, offset, old, new in [('client.dir', 79809593, 2, 3), ('host.dir', 141340, 91, 92)]:
            with self.subTest(movie=movie), tempfile.TemporaryDirectory() as directory:
                original=(ROOT/'recovered/director/movies/original'/movie).read_bytes()
                destination=Path(directory)/movie
                destination.write_bytes(original)
                provenance=patch_gomu_startup(destination)
                patched=destination.read_bytes()
                self.assertEqual(provenance['absolute_offset'],offset)
                self.assertEqual(original[offset],old)
                self.assertEqual(patched[offset],new)
                self.assertEqual(original[:offset],patched[:offset])
                self.assertEqual(original[offset+1:],patched[offset+1:])
                self.assertEqual(original[offset-1],0x67) # same object-call opcode
                self.assertEqual(original[offset+1],0x01) # same return instruction
                # Unknown/repeated inputs fail closed rather than modifying arbitrary bytes.
                with self.assertRaisesRegex(RuntimeError,'missing or ambiguous'):
                    patch_gomu_startup(destination)
                self.assertEqual(destination.read_bytes(),patched)

    def test_unrecognized_movie_is_not_modified(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'client.dir'; path.write_bytes(b'not the original Director movie')
            with self.assertRaisesRegex(RuntimeError,'missing or ambiguous'):
                patch_gomu_startup(path)
            self.assertEqual(path.read_bytes(),b'not the original Director movie')

if __name__=='__main__': unittest.main()
