// Paddle 연결 준비 전까지 비워 둔다. 추후 플랜별 HTTPS 결제 링크를 넣는다.
// 공개되는 파일이므로 Paddle API 비밀 키와 Gemini 키는 절대 넣지 않는다.
window.SUMMRIZEI_CHECKOUT = Object.freeze({
  basic: "",
  standard: "",
  premium: "",
});

// Chrome 웹 스토어 등록 완료 후 확장 프로그램 상세 URL을 설정한다.
window.SUMMRIZEI_INSTALL_URL = "";
