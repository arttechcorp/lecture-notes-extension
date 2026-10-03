window.SUMMRIZEI_BILLING = Object.freeze({
  // Groble 대시보드에서 만든 결제창/고객 포털 주소를 넣는다. 비어 있으면 화면은 "결제 준비 중"으로 안내하고 사전 예약으로 돌린다.
  checkout: { essential: "https://groble.im/payment/u9m5dR", essential_edu: "https://groble.im/payment/a5DgpJ", professional: "https://groble.im/payment/grxETv" },
  // 구독 해지·결제 내역은 Groble에서 한다(로그인 → 상단 프로필 → 구매내역 → 주문 → 해지하기). 전용 고객 포털이 없어 메인 주소를 둔다.
  portal: "https://www.groble.im",
  support: "jihwanbu26@gmail.com",
});
