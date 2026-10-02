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

const {localSlideDoc,isFormulaLine}=require("./layout.js");
const Contracts=require("./contracts.js");
const at=(text,x,y,width,height,confidence=.9)=>({text,confidence,box:{x,y,width,height}});

test("로컬 OCR 줄은 유료 비전과 같은 SlideDoc 계약을 통과한다",()=>{
  const doc=localSlideDoc([at("현금흐름 할인",100,40,600,60),at("미래 현금을 현재 가치로",100,200,500,30),at("PV = CF / (1 + r)^t",100,300,400,30),at("   ",0,0,1,1)],1280,720,{slideId:"s7",t0:12.5,t1:30});
  assert.deepEqual(Contracts.validate(Contracts.SCHEMAS.slideDoc,doc),{ok:true});
  assert.equal(doc.engine,"ppocr-v5");assert.equal(doc.slideId,"s7");assert.equal(doc.t0,12.5);
  assert.deepEqual(doc.blocks.map(b=>[b.id,b.role,b.text]),[["b1","title","현금흐름 할인"],["b2","body","미래 현금을 현재 가치로"]]);
  assert.deepEqual(doc.formulas.map(f=>[f.id,f.latex,f.text,f.status]),[["f1",null,"PV = CF / (1 + r)^t","unverified"]]);
  assert.deepEqual(doc.blocks[0].bbox,{x:100/1280,y:40/720,w:600/1280,h:60/720});
  assert.deepEqual(doc.figures,[]);
});

test("제목은 위쪽의 확실히 큰 글씨만이고, 쪼개진 제목 상자는 함께 묶는다",()=>{
  const split=localSlideDoc([at("기대",100,40,120,60),at("이론",240,42,120,58),at("본문 한 줄",100,300,300,30),at("본문 두 줄",100,360,300,30)],1280,720);
  assert.deepEqual(split.blocks.map(b=>b.role),["title","title","body","body"]);
  // 크기가 같으면 위에 있어도 제목이 아니다 — 본문 첫 줄을 제목으로 오인하면 반복 필터에서 면제된다.
  const flat=localSlideDoc([at("첫 줄",100,40,300,30),at("둘째 줄",100,100,300,30),at("셋째 줄",100,160,300,30)],1280,720);
  assert.ok(flat.blocks.every(b=>b.role==="body"));
  // 아래쪽의 큰 글씨는 제목이 아니다.
  const low=localSlideDoc([at("작은 줄",100,40,300,30),at("큰 결론",100,500,600,80)],1280,720);
  assert.ok(low.blocks.every(b=>b.role==="body"));
  // 한 줄뿐이면 비교 기준이 없다.
  assert.equal(localSlideDoc([at("혼자",100,40,600,80)],1280,720).blocks[0].role,"body");
});

test("가장자리의 작은 글씨도 본문으로 둔다 — 반복 판정은 여러 장을 보는 boilerplate 몫이다",()=>{
  const doc=localSlideDoc([at("2024123456 홍길동",1100,690,170,20),at("12",1240,700,30,20),at("본문",100,300,300,30)],1280,720);
  assert.ok(doc.blocks.every(b=>b.role==="body"));
  assert.equal(doc.blocks.length,3);
});

test("수식 줄 판정은 보수적이다",()=>{
  for(const s of ["a=(1 +ζk) −1","PV = CF / (1 + r)^t","x² + y² = r²","p < .05","y = sin(x) + log(x)","E = mc^2"])assert.equal(isFormulaLine(s),true,s);
  for(const s of ["총수익 = 가격 × 수량","Profit = Revenue - Cost","https://a.example/b?x=1","===","2026-10-02","A → B","10 20 30","x=","Q1 = 25% 상승"])assert.equal(isFormulaLine(s),false,s);
});

test("좌표나 화면 크기를 모르면 bbox 는 null 이고 제목도 고르지 않는다",()=>{
  const doc=localSlideDoc([{text:"가",confidence:2},{text:"나 = 1"},{text:"x = 1",box:{x:1,y:1,width:1,height:1}}],0,720,{t0:-3,t1:NaN});
  assert.deepEqual(Contracts.validate(Contracts.SCHEMAS.slideDoc,doc),{ok:true});
  assert.equal(doc.blocks[0].bbox,null);assert.equal(doc.blocks[0].conf,1);assert.equal(doc.blocks[1].conf,null);
  assert.equal(doc.formulas[0].bbox,null);assert.equal(doc.t0,0);assert.equal(doc.t1,0);
  assert.ok(doc.blocks.every(b=>b.role==="body"));
  assert.deepEqual(localSlideDoc(null,1280,720).blocks,[]);
});
