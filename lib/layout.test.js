const test=require("node:test"),assert=require("node:assert/strict");
const {layoutText}=require("./layout.js");

const line=(text,x,y)=>({text,box:{x,y,width:10,height:10}});

test("줄맞춤된 본문 슬라이드에는 좌표를 붙이지 않는다",()=>{
  // 제목 + 글머리. x 가 두 자리뿐이라 좌표가 알려주는 것이 없다 — 토큰만 늘어난다.
  const bullets=[line("반도체 물리",100,80),line("에너지 밴드",140,200),line("전도대",140,300),line("원자가대",140,400)];
  assert.equal(layoutText(bullets,1000,600),"반도체 물리\n에너지 밴드\n전도대\n원자가대");
});

test("흩어진 라벨에는 좌표를 실어 도식을 복원할 수 있게 한다",()=>{
  const diagram=[line("전도대",550,180),line("Eg",700,300),line("원자가대",300,470),line("Si",120,90)];
  const out=layoutText(diagram,1000,600);
  assert.match(out,/^\(55,30\) 전도대$/m,"좌표가 화면 비율(%)로 실리지 않는다");
  assert.match(out,/^\(70,50\) Eg$/m);
  assert.equal(out.split("\n").length,4,"줄 수가 변한다 — 원문이 유실되거나 늘었다");
  for(const label of ["전도대","Eg","원자가대","Si"])assert.ok(out.includes(label),`${label} 이(가) 사라졌다`);
});

test("좌표가 없거나 크기를 모르면 평문으로 되돌린다",()=>{
  assert.equal(layoutText([{text:"글자"},{text:"둘"},{text:"셋"}],1000,600),"글자\n둘\n셋");
  const scattered=[line("가",10,10),line("나",500,200),line("다",900,400)];
  assert.equal(layoutText(scattered,0,600),"가\n나\n다","크기를 모르는데 0 으로 나눈 좌표를 만든다");
  assert.equal(layoutText([],1000,600),"");
  assert.equal(layoutText(null,1000,600),"");
});

test("빈 문자열 줄은 버리고 좌표 계산에도 넣지 않는다",()=>{
  const mixed=[line("가",10,10),line("   ",500,200),line("나",900,400),line("다",450,300)];
  const out=layoutText(mixed,1000,600);
  assert.equal(out.split("\n").length,3);
  assert.doesNotMatch(out,/\(50,33\)/,"공백 줄이 좌표까지 달고 남는다");
});
