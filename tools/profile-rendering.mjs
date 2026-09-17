// Run through the Browser skill's CDP capability. This probe observes an
// isolated game tab; all temporary wrappers are restored before it returns.
export function renderingProbe(duration = 8000, changing = false) {
  return `(async()=>{
    const duration=${duration}, changing=${changing};
    const frames=[], reads={}, uploads={};
    const p=CanvasRenderingContext2D.prototype, originalRead=p.getImageData;
    const g=WebGL2RenderingContext.prototype, originalUpload=g.texImage2D;
    const originalSub=g.texSubImage2D, originalCreate=g.createTexture;
    let creations=0, subUploads=0, sourcePixels=null, uploadedPixels=null, captureSequence=0;
    p.getImageData=function(...a){const t=performance.now();const result=originalRead.apply(this,a);
      if(changing&&a[2]===1600&&a[3]===1200)result.data[0]^=(++captureSequence&1);
      const k=a[2]+'x'+a[3],v=reads[k]??={calls:0,ms:0};v.calls++;v.ms+=performance.now()-t;
      if(a[2]===1600&&a[3]===1200&&!sourcePixels)sourcePixels=new Uint8Array(result.data);
      return result;};
    g.texImage2D=function(...a){const k=typeof a[3]==='number'?a[3]+'x'+a[4]:'source';uploads[k]=(uploads[k]||0)+1;
      if(a[3]===1600&&a[4]===1200&&a[8]?.byteLength&&!uploadedPixels)uploadedPixels=new Uint8Array(a[8]);
      return originalUpload.apply(this,a);};
    g.texSubImage2D=function(...a){subUploads++;if(a[4]===1600&&a[5]===1200&&a[8]?.byteLength&&!uploadedPixels)uploadedPixels=new Uint8Array(a[8]);return originalSub.apply(this,a);};
    g.createTexture=function(...a){creations++;return originalCreate.apply(this,a);};
    const start=performance.now();let previous=start,raf;
    try {
      await new Promise(resolve=>{const tick=t=>{frames.push(t-previous);previous=t;if(t-start>=duration)resolve();else raf=requestAnimationFrame(tick)};raf=requestAnimationFrame(tick);setTimeout(resolve,duration+1500)});
      const sorted=frames.slice(1).sort((a,b)=>a-b);
      const hash=async a=>a?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a)),x=>x.toString(16).padStart(2,'0')).join(''):null;
      const sourceHash=await hash(sourcePixels),uploadedHash=await hash(uploadedPixels);
      const allowedHashes=[sourceHash];if(changing&&sourcePixels){const other=sourcePixels.slice();other[0]^=1;allowedHashes.push(await hash(other));}
      const uploadedPixelsMatch=uploadedHash===null?null:allowedHashes.includes(uploadedHash);
      if(uploadedPixelsMatch===false)throw Error('Uploaded texture differs from captured pixels');
      return {changing,durationMs:performance.now()-start,visibility:document.visibilityState,dpr:devicePixelRatio,
        frameCallbacks:sorted.length,meanMs:sorted.reduce((a,b)=>a+b,0)/sorted.length,p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1),over33:sorted.filter(x=>x>33.4).length,
        reads,uploads,subUploads,textureCreations:creations,sourceHash,uploadedHash,uploadedPixelsMatch,
        state:JSON.parse(window.__vm.mcp_get_execution_state()),tutorial:JSON.parse(await window.__vm.mcp_eval_lingo('gTutorial.pCurrentFrameNum'))};
    } finally {cancelAnimationFrame(raf);p.getImageData=originalRead;g.texImage2D=originalUpload;g.texSubImage2D=originalSub;g.createTexture=originalCreate;}
  })()`;
}

// Count actual clears of the displayed framebuffer, excluding the renderer's
// offscreen ink/compositing passes. This is separate from browser rAF cadence.
export function stageCadenceProbe(duration = 5000) {
  return `(async()=>{
    const p=WebGL2RenderingContext.prototype,clear=p.clear,bind=p.bindFramebuffer,colorMask=p.colorMask;
    const targets=new WeakMap(),rgbWrites=new WeakMap(),times=[],canvas=document.querySelector('canvas');
    p.colorMask=function(r,g,b,a){rgbWrites.set(this,r||g||b);return colorMask.call(this,r,g,b,a)};
    p.bindFramebuffer=function(target,buffer){const result=bind.call(this,target,buffer);if(target===this.FRAMEBUFFER||target===this.DRAW_FRAMEBUFFER)targets.set(this,buffer);return result};
    p.clear=function(mask){if(this.canvas===canvas){if(!targets.has(this))targets.set(this,this.getParameter(this.FRAMEBUFFER_BINDING));if(!targets.get(this)&&rgbWrites.get(this)!==false&&(mask&this.COLOR_BUFFER_BIT))times.push(performance.now())}return clear.call(this,mask)};
    const start=performance.now();try{await new Promise(r=>setTimeout(r,${duration}));const elapsed=performance.now()-start,intervals=times.slice(1).map((t,i)=>t-times[i]).sort((a,b)=>a-b);return{elapsedMs:elapsed,frames:times.length,fps:times.length*1000/elapsed,p50Ms:intervals[Math.floor(intervals.length*.5)],p95Ms:intervals[Math.floor(intervals.length*.95)],tempo:window.__dirplayerFrameTempo}}finally{p.clear=clear;p.bindFramebuffer=bind;p.colorMask=colorMask}
  })()`;
}
