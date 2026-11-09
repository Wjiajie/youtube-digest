/* Downsample the actual microphone stream to paced 16 kHz, 20 ms PCM frames. */
class CompanionCapture extends AudioWorkletProcessor {
 constructor(){super();this.pending=[];this.phase=0;this.sum=0;this.count=0;}
 process(inputs){
  const data=inputs[0]?.[0];if(!data)return true;
  for(const value of data){
   this.sum+=value;this.count++;this.phase+=16000;
   if(this.phase>=sampleRate){this.phase-=sampleRate;this.pending.push(this.sum/this.count);this.sum=0;this.count=0;}
   if(this.pending.length===320){
    const pcm=new Int16Array(320);let power=0;
    for(let i=0;i<320;i++){const v=Math.max(-1,Math.min(1,this.pending[i]));pcm[i]=v<0?v*32768:v*32767;power+=v*v;}
    this.port.postMessage({pcm:pcm.buffer,rms:Math.sqrt(power/320)},[pcm.buffer]);this.pending=[];
   }
  }
  return true;
 }
}
registerProcessor("companion-capture",CompanionCapture);
