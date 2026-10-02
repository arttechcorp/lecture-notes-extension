// 패널이 chrome.storage.session 에 넣어 둔 노트를 받아 sandbox 에 인쇄를 시킨다. 노트 본문은 URL 에 싣지 않는다.
const frame = document.getElementById('frame');
frame.addEventListener('load', async () => {
  const { printJob } = await chrome.storage.session.get('printJob');
  await chrome.storage.session.remove('printJob');
  if (!printJob?.markdown) { document.body.textContent = '인쇄할 노트가 없습니다. 패널에서 PDF 출력을 다시 누르세요.'; return; }
  frame.contentWindow.postMessage({ type: 'PRINT', ...printJob }, '*');
});
window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow) return;
  if (event.data?.type === 'PRINT_COMPLETE') window.close();
  else if (event.data?.type === 'PRINT_ERROR') document.body.textContent = `PDF 인쇄 오류: ${event.data.error || '알 수 없는 오류'}`;
});
