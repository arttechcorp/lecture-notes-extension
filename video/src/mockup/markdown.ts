// landing/note-viewer.js 의 render() 를 그대로 옮겼다. 제품과 같은 마크업이 나와야 product-panel.css 가 맞는다.
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: false, breaks: false });
md.renderer.rules.table_open = () => '<div class="note-table-scroll"><table>';
md.renderer.rules.table_close = () => '</table></div>\n';

// 목록의 체크박스만 변환한다. 코드·문단 속 [x]는 원문으로 남긴다.
md.core.ruler.after('inline', 'note_tasks', (state) => {
  for (let i = 0; i < state.tokens.length - 2; i++) {
    const [item, paragraph, inline] = state.tokens.slice(i, i + 3);
    if (item.type !== 'list_item_open' || paragraph.type !== 'paragraph_open' || inline.type !== 'inline') continue;
    const first = inline.children?.[0];
    const match = first?.type === 'text' && first.content.match(/^\[([ xX])\]\s+/);
    if (!match) continue;
    first.content = first.content.slice(match[0].length);
    const checkbox = new state.Token('html_inline', '', 0);
    checkbox.content = `<input type="checkbox" disabled${match[1] === ' ' ? '' : ' checked'}>`;
    inline.children!.unshift(checkbox);
    item.attrJoin('class', 'note-task');
  }
  return true;
});

export const renderNote = (text: string, title = '') => {
  const tokens = md.parse(text || '', {});
  // 바깥의 강의 제목과 완전히 같은 첫 제목은 한 번만 보여 준다.
  if (title && tokens[0]?.type === 'heading_open' && tokens[1]?.content === title) tokens.splice(0, 3);
  return md.renderer.render(tokens, md.options, {});
};
