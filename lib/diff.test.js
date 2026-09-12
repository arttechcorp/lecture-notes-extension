const test=require("node:test"),assert=require("node:assert/strict");
const {delta,tileChange}=require("./visual-gate");
test("visual gate ignores small compression noise and notices local text changes",()=>{
  const base=new Uint8Array(256*144).fill(200),noise=Uint8Array.from(base,(v,i)=>v+(i%5)-2),changed=new Uint8Array(base);
  changed.fill(30,0,Math.round(changed.length*.04));
  assert.equal(delta(base,noise),0);
  assert.equal(delta(base,changed)>.035,true);
  assert.equal(tileChange(base,changed)>.035,true);
});
