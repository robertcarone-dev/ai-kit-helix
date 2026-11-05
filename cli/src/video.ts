/** Read WebM track dimensions rather than claiming the viewport is the encoded size. */
export function webmDimensions(bytes:Buffer):{width:number;height:number} {
 function vint(offset:number,id=false){
  const first=bytes[offset];let length=1;while(length<=8&&!(first&(1<<(8-length))))length++;
  if(length>8||offset+length>bytes.length)throw new Error('Invalid WebM element.');
  let value=id?first:first&((1<<(8-length))-1);
  for(let i=1;i<length;i++)value=value*256+bytes[offset+i];
  return {length,value};
 }
 const containers=new Set([0x18538067,0x1654AE6B,0xAE,0xE0]);
 function scan(start:number,end:number):{width:number;height:number}|null {
  let width:number|undefined,height:number|undefined;
  for(let p=start;p<end;){
   const id=vint(p,true);p+=id.length;const size=vint(p);p+=size.length;
   const next=Math.min(end,p+size.value);
   if(containers.has(id.value)){const found=scan(p,next);if(found)return found;}
   if(id.value===0xB0||id.value===0xBA){if(size.value>4)throw new Error('Invalid WebM dimensions.');const n=bytes.readUIntBE(p,size.value);if(id.value===0xB0)width=n;else height=n;}
   if(width&&height)return {width,height};
   if(next<=p)throw new Error('Invalid WebM length.');p=next;
  }
  return null;
 }
 const result=scan(0,bytes.length);if(!result)throw new Error('WebM has no readable video dimensions.');return result;
}
