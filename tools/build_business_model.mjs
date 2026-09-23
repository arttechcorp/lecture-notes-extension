import fs from 'node:fs/promises';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const outDir = '/Users/giwook/Documents/lecture-summary/lecture-notes-extension/review';
await fs.mkdir(outDir, { recursive: true });

const wb = Workbook.create();
const overview = wb.worksheets.add('Overview');
const assumptions = wb.worksheets.add('Assumptions');
const model = wb.worksheets.add('Monthly Model');
const sources = wb.worksheets.add('Sources');

const navy = '#17324D';
const blue = '#DCEAF7';
const yellow = '#FFF2CC';
const green = '#E2F0D9';
const red = '#FCE4D6';
const gray = '#F3F5F7';
const font = 'Arial';
const won = '#,##0"원";[Red](#,##0"원")';
const pct = '0.0%';
const num = '#,##0';

function baseSheet(sheet) {
  sheet.showGridLines = false;
  sheet.getRange('A1:Z120').format.font = { name: font, size: 10, color: '#1F2937' };
  sheet.getRange('A1:Z120').format.verticalAlignment = 'center';
}
function title(sheet, text) {
  sheet.getRange('A1').values = [[text]];
  sheet.getRange('A1').format = { font: { name: font, size: 16, bold: true, color: navy } };
  sheet.getRange('A2').format.fill = '#FFFFFF';
}
function section(sheet, range, text) {
  sheet.getRange(range).merge();
  sheet.getRange(range.split(':')[0]).values = [[text]];
  sheet.getRange(range).format = { fill: navy, font: { name: font, size: 10, bold: true, color: '#FFFFFF' }, horizontalAlignment: 'left' };
}
function header(sheet, range) {
  sheet.getRange(range).format = { fill: blue, font: { name: font, size: 10, bold: true, color: navy }, horizontalAlignment: 'center', wrapText: true };
}
function input(sheet, range, format = null) {
  sheet.getRange(range).format = { fill: yellow, font: { name: font, size: 10, color: '#1F2937' } };
  if (format) sheet.getRange(range).format.numberFormat = format;
}
function calc(sheet, range, format = null) {
  sheet.getRange(range).format = { fill: '#FFFFFF', font: { name: font, size: 10, color: '#1F2937' } };
  if (format) sheet.getRange(range).format.numberFormat = format;
}

// Assumptions
baseSheet(assumptions); title(assumptions, 'Lecture Notes business model assumptions');
assumptions.getRange('A3:B5').values = [
  ['Active case', 'Base'],
  ['Model horizon (months)', 12],
  ['Currency', 'KRW'],
];
input(assumptions, 'B3:B5');
assumptions.getRange('B3').format.font = { name: font, size: 10, bold: true, color: '#9A6700' };
assumptions.getRange('D3:H5').values = [
  ['Case', 'Downside', 'Base', 'Upside', 'Notes'],
  ['Meaning', 'Lower acquisition / higher churn', 'Planning case', 'Higher acquisition / lower churn', 'Change yellow cells only'],
  ['Selector', 1, 2, 3, 'The build currently uses Base column values'],
];
header(assumptions, 'D3:H3'); assumptions.getRange('D4:H5').format.wrapText = true;
section(assumptions, 'A8:E8', 'Pricing and trial');
assumptions.getRange('A9:E20').values = [
  ['Driver', 'Value', 'Downside', 'Base', 'Upside'],
  ['Essential monthly price', 21900, 21900, 21900, 21900],
  ['Edu monthly price', 12900, 12900, 12900, 12900],
  ['Pro monthly price', 28900, 28900, 28900, 28900],
  ['Trial days', 14, 14, 14, 14],
  ['Trial minutes cap', 200, 200, 200, 200],
  ['Trial start rate', 0.7, 0.6, 0.7, 0.8],
  ['Regular trial to paid', 0.28, 0.2, 0.28, 0.36],
  ['Preorder to paid', 0.35, 0.25, 0.35, 0.45],
  ['Paid plan mix: Essential', 0.45, 0.5, 0.45, 0.4],
  ['Paid plan mix: Edu', 0.4, 0.38, 0.4, 0.42],
  ['Paid plan mix: Pro', 0.15, 0.12, 0.15, 0.18],
];
header(assumptions, 'A9:E9'); input(assumptions, 'B10:E20');
assumptions.getRange('B10:E12').format.numberFormat = won; assumptions.getRange('B13:E14').format.numberFormat = num; assumptions.getRange('B15:E20').format.numberFormat = pct;
assumptions.getRange('G9:H15').values = [
  ['Offer rule', 'Model treatment'],
  ['Preorder benefit', 'First paid month free after card registration'],
  ['Referral reward', '1 free month for each 2 qualified referred activations'],
  ['Qualified referral', 'Referral signup starts trial and completes first summary'],
  ['Free plan', 'No revenue; still consumes support / infrastructure'],
  ['Card billing', 'Revenue begins after free month / trial'],
  ['Important', 'Replace assumptions with measured funnel data as soon as available'],
];
header(assumptions, 'G9:H9'); assumptions.getRange('G10:H15').format.wrapText = true;

section(assumptions, 'A23:E23', 'Acquisition and retention drivers');
assumptions.getRange('A24:E37').values = [
  ['Driver', 'Value', 'Downside', 'Base', 'Upside'],
  ['Preorder waitlist signups (month 1)', 800, 500, 800, 1200],
  ['Organic signups (month 1)', 120, 80, 120, 180],
  ['Organic monthly growth', 0.08, 0.03, 0.08, 0.15],
  ['Referral share of new signups', 0.08, 0.04, 0.08, 0.14],
  ['Free-plan activation from signup', 0.55, 0.5, 0.55, 0.65],
  ['Monthly paid churn: Essential', 0.06, 0.08, 0.06, 0.04],
  ['Monthly paid churn: Edu', 0.05, 0.07, 0.05, 0.035],
  ['Monthly paid churn: Pro', 0.04, 0.06, 0.04, 0.025],
  ['Referral qualified rate', 0.6, 0.45, 0.6, 0.72],
  ['Referral reward cap (months)', 1, 1, 1, 1],
  ['Average free users per paid user', 1.2, 1.5, 1.2, 0.9],
  ['Average lecture minutes per paid user', 120, 150, 120, 100],
  ['Average lecture minutes per free user', 60, 75, 60, 45],
];
header(assumptions, 'A24:E24'); input(assumptions, 'B25:E37'); assumptions.getRange('B25:E26').format.numberFormat = num; assumptions.getRange('B27:E33').format.numberFormat = pct; assumptions.getRange('B34:E34').format.numberFormat = num; assumptions.getRange('B35:E35').format.numberFormat = num; assumptions.getRange('B36:E36').format.numberFormat = num; assumptions.getRange('B37:E37').format.numberFormat = num;

section(assumptions, 'A40:E40', 'Cost and operating drivers');
assumptions.getRange('A41:E52').values = [
  ['Driver', 'Value', 'Downside', 'Base', 'Upside'],
  ['Vercel monthly fixed cost', 250000, 300000, 250000, 250000],
  ['Supabase monthly fixed cost', 250000, 300000, 250000, 250000],
  ['Other fixed operating cost', 200000, 300000, 200000, 150000],
  ['Marketing and support cost', 1000000, 1500000, 1000000, 800000],
  ['LLM API cost per lecture minute', 35, 45, 35, 25],
  ['Payment processing rate', 0.035, 0.035, 0.035, 0.03],
  ['Payment fixed fee per transaction', 100, 100, 100, 100],
  ['Variable support cost per active user', 400, 500, 400, 300],
  ['Referral reward cost basis', 'Weighted ARPU', 'Weighted ARPU', 'Weighted ARPU', 'Weighted ARPU'],
  ['Tax / VAT reserve rate', 0, 0, 0, 0],
  ['Founder salary / payroll not included', 0, 0, 0, 0],
];
header(assumptions, 'A41:E41'); input(assumptions, 'B42:E52'); assumptions.getRange('B42:E45').format.numberFormat = won; assumptions.getRange('B46:E46').format.numberFormat = won; assumptions.getRange('B47:E47').format.numberFormat = pct; assumptions.getRange('B48:E50').format.numberFormat = won; assumptions.getRange('B51:E51').format.numberFormat = pct;
assumptions.getRange('G41:H47').values = [
  ['Cost note', 'Interpretation'],
  ['LLM API', 'Variable cost driven by lecture minutes; replace with provider invoice data'],
  ['Vercel / Supabase', 'Modeled as fixed monthly baseline; change to actual plan + overage'],
  ['Payment fee', 'Approximation only; confirm processor fee and tax treatment'],
  ['Payroll', 'Explicitly excluded until staffing plan is known'],
  ['Tax / VAT', 'Set to actual reserve when tax treatment is decided'],
  ['Break-even', 'Net profit before excluded payroll and tax reserve if set to 0%'],
];
header(assumptions, 'G41:H41'); assumptions.getRange('G42:H47').format.wrapText = true;

// Monthly model
baseSheet(model); title(model, 'Monthly operating model');
model.getRange('A3:N3').values = [['Metric', 'Unit', 'Month 1', 'Month 2', 'Month 3', 'Month 4', 'Month 5', 'Month 6', 'Month 7', 'Month 8', 'Month 9', 'Month 10', 'Month 11', 'Month 12']];
header(model, 'A3:N3');
section(model, 'A5:N5', 'Acquisition funnel');
const acq = [
  ['Preorder waitlist signups', 'people'], ['Organic signups', 'people'], ['Referral signups', 'people'], ['Total new signups', 'people'], ['Trial starts', 'people'], ['Regular paid conversions', 'people'], ['Preorder paid conversions', 'people'], ['Total new paid customers', 'people'],
];
model.getRange('A6:B13').values = acq;
model.getRange('C6:N13').formulas = [
  ["='Assumptions'!$B$25", "='Assumptions'!$B$25", "='Assumptions'!$B$25", "='Assumptions'!$B$25", "='Assumptions'!$B$25", "='Assumptions'!$B$25", "='Assumptions'!$B$25", "='Assumptions'!$B$25", "='Assumptions'!$B$25", "='Assumptions'!$B$25", "='Assumptions'!$B$25", "='Assumptions'!$B$25"],
  ["='Assumptions'!$B$26", "=C7*(1+'Assumptions'!$B$27)", "=D7*(1+'Assumptions'!$B$27)", "=E7*(1+'Assumptions'!$B$27)", "=F7*(1+'Assumptions'!$B$27)", "=G7*(1+'Assumptions'!$B$27)", "=H7*(1+'Assumptions'!$B$27)", "=I7*(1+'Assumptions'!$B$27)", "=J7*(1+'Assumptions'!$B$27)", "=K7*(1+'Assumptions'!$B$27)", "=L7*(1+'Assumptions'!$B$27)", "=M7*(1+'Assumptions'!$B$27)"],
  ["=C8*'Assumptions'!$B$28", "=D8*'Assumptions'!$B$28", "=E8*'Assumptions'!$B$28", "=F8*'Assumptions'!$B$28", "=G8*'Assumptions'!$B$28", "=H8*'Assumptions'!$B$28", "=I8*'Assumptions'!$B$28", "=J8*'Assumptions'!$B$28", "=K8*'Assumptions'!$B$28", "=L8*'Assumptions'!$B$28", "=M8*'Assumptions'!$B$28", "=N8*'Assumptions'!$B$28"],
  ['=SUM(C6:C8)', '=SUM(D6:D8)', '=SUM(E6:E8)', '=SUM(F6:F8)', '=SUM(G6:G8)', '=SUM(H6:H8)', '=SUM(I6:I8)', '=SUM(J6:J8)', '=SUM(K6:K8)', '=SUM(L6:L8)', '=SUM(M6:M8)', '=SUM(N6:N8)'],
  ['=C9*\'Assumptions\'!$B$15', '=D9*\'Assumptions\'!$B$15', '=E9*\'Assumptions\'!$B$15', '=F9*\'Assumptions\'!$B$15', '=G9*\'Assumptions\'!$B$15', '=H9*\'Assumptions\'!$B$15', '=I9*\'Assumptions\'!$B$15', '=J9*\'Assumptions\'!$B$15', '=K9*\'Assumptions\'!$B$15', '=L9*\'Assumptions\'!$B$15', '=M9*\'Assumptions\'!$B$15', '=N9*\'Assumptions\'!$B$15'],
  ['=C10*\'Assumptions\'!$B$16*(1-C6/C9)', '=D10*\'Assumptions\'!$B$16', '=E10*\'Assumptions\'!$B$16', '=F10*\'Assumptions\'!$B$16', '=G10*\'Assumptions\'!$B$16', '=H10*\'Assumptions\'!$B$16', '=I10*\'Assumptions\'!$B$16', '=J10*\'Assumptions\'!$B$16', '=K10*\'Assumptions\'!$B$16', '=L10*\'Assumptions\'!$B$16', '=M10*\'Assumptions\'!$B$16', '=N10*\'Assumptions\'!$B$16'],
  ['=C6*\'Assumptions\'!$B$17', '=D6*\'Assumptions\'!$B$17', '=E6*\'Assumptions\'!$B$17', '=F6*\'Assumptions\'!$B$17', '=G6*\'Assumptions\'!$B$17', '=H6*\'Assumptions\'!$B$17', '=I6*\'Assumptions\'!$B$17', '=J6*\'Assumptions\'!$B$17', '=K6*\'Assumptions\'!$B$17', '=L6*\'Assumptions\'!$B$17', '=M6*\'Assumptions\'!$B$17', '=N6*\'Assumptions\'!$B$17'],
  ['=SUM(C11:C12)', '=SUM(D11:D12)', '=SUM(E11:E12)', '=SUM(F11:F12)', '=SUM(G11:G12)', '=SUM(H11:H12)', '=SUM(I11:I12)', '=SUM(J11:J12)', '=SUM(K11:K12)', '=SUM(L11:L12)', '=SUM(M11:M12)', '=SUM(N11:N12)'],
];
section(model, 'A15:N15', 'Active paid customers');
model.getRange('A16:B20').values = [['Essential ending customers', 'people'], ['Edu ending customers', 'people'], ['Pro ending customers', 'people'], ['Total paid customers', 'people'], ['Free / trial active users', 'people']];
model.getRange('C16:N20').formulas = [
  ["=C13*'Assumptions'!$B$19", "=C16*(1-'Assumptions'!$B$29)+D13*'Assumptions'!$B$19", "=D16*(1-'Assumptions'!$B$29)+E13*'Assumptions'!$B$19", "=E16*(1-'Assumptions'!$B$29)+F13*'Assumptions'!$B$19", "=F16*(1-'Assumptions'!$B$29)+G13*'Assumptions'!$B$19", "=G16*(1-'Assumptions'!$B$29)+H13*'Assumptions'!$B$19", "=H16*(1-'Assumptions'!$B$29)+I13*'Assumptions'!$B$19", "=I16*(1-'Assumptions'!$B$29)+J13*'Assumptions'!$B$19", "=J16*(1-'Assumptions'!$B$29)+K13*'Assumptions'!$B$19", "=K16*(1-'Assumptions'!$B$29)+L13*'Assumptions'!$B$19", "=L16*(1-'Assumptions'!$B$29)+M13*'Assumptions'!$B$19", "=M16*(1-'Assumptions'!$B$29)+N13*'Assumptions'!$B$19"],
  ["=C13*'Assumptions'!$B$20", "=C17*(1-'Assumptions'!$B$30)+D13*'Assumptions'!$B$20", "=D17*(1-'Assumptions'!$B$30)+E13*'Assumptions'!$B$20", "=E17*(1-'Assumptions'!$B$30)+F13*'Assumptions'!$B$20", "=F17*(1-'Assumptions'!$B$30)+G13*'Assumptions'!$B$20", "=G17*(1-'Assumptions'!$B$30)+H13*'Assumptions'!$B$20", "=H17*(1-'Assumptions'!$B$30)+I13*'Assumptions'!$B$20", "=I17*(1-'Assumptions'!$B$30)+J13*'Assumptions'!$B$20", "=J17*(1-'Assumptions'!$B$30)+K13*'Assumptions'!$B$20", "=K17*(1-'Assumptions'!$B$30)+L13*'Assumptions'!$B$20", "=L17*(1-'Assumptions'!$B$30)+M13*'Assumptions'!$B$20", "=M17*(1-'Assumptions'!$B$30)+N13*'Assumptions'!$B$20"],
  ["=C13*'Assumptions'!$B$21", "=C18*(1-'Assumptions'!$B$31)+D13*'Assumptions'!$B$21", "=D18*(1-'Assumptions'!$B$31)+E13*'Assumptions'!$B$21", "=E18*(1-'Assumptions'!$B$31)+F13*'Assumptions'!$B$21", "=F18*(1-'Assumptions'!$B$31)+G13*'Assumptions'!$B$21", "=G18*(1-'Assumptions'!$B$31)+H13*'Assumptions'!$B$21", "=H18*(1-'Assumptions'!$B$31)+I13*'Assumptions'!$B$21", "=I18*(1-'Assumptions'!$B$31)+J13*'Assumptions'!$B$21", "=J18*(1-'Assumptions'!$B$31)+K13*'Assumptions'!$B$21", "=K18*(1-'Assumptions'!$B$31)+L13*'Assumptions'!$B$21", "=L18*(1-'Assumptions'!$B$31)+M13*'Assumptions'!$B$21", "=M18*(1-'Assumptions'!$B$31)+N13*'Assumptions'!$B$21"],
  ['=SUM(C16:C18)', '=SUM(D16:D18)', '=SUM(E16:E18)', '=SUM(F16:F18)', '=SUM(G16:G18)', '=SUM(H16:H18)', '=SUM(I16:I18)', '=SUM(J16:J18)', '=SUM(K16:K18)', '=SUM(L16:L18)', '=SUM(M16:M18)', '=SUM(N16:N18)'],
  ["=C9*'Assumptions'!$B$29", "=D9*'Assumptions'!$B$29", "=E9*'Assumptions'!$B$29", "=F9*'Assumptions'!$B$29", "=G9*'Assumptions'!$B$29", "=H9*'Assumptions'!$B$29", "=I9*'Assumptions'!$B$29", "=J9*'Assumptions'!$B$29", "=K9*'Assumptions'!$B$29", "=L9*'Assumptions'!$B$29", "=M9*'Assumptions'!$B$29", "=N9*'Assumptions'!$B$29"],
];
section(model, 'A22:N22', 'Revenue and costs');
model.getRange('A23:B38').values = [
  ['Weighted ARPU', 'KRW / paid user'], ['Gross subscription revenue', 'KRW'], ['Preorder free-month discount', 'KRW'], ['Referral free-month discount', 'KRW'], ['Net subscription revenue', 'KRW'], ['LLM lecture minutes', 'minutes'], ['LLM API cost', 'KRW'], ['Payment processing cost', 'KRW'], ['Variable support cost', 'KRW'], ['Vercel fixed cost', 'KRW'], ['Supabase fixed cost', 'KRW'], ['Other fixed operating cost', 'KRW'], ['Marketing and support cost', 'KRW'], ['Total operating cost', 'KRW'], ['Net profit before tax/payroll', 'KRW'], ['Net margin', '%'],
];
model.getRange('C23:N38').formulas = [
  ["='Assumptions'!$B$10*'Assumptions'!$B$19+'Assumptions'!$B$11*'Assumptions'!$B$20+'Assumptions'!$B$12*'Assumptions'!$B$21", "=C23", "=C23", "=C23", "=C23", "=C23", "=C23", "=C23", "=C23", "=C23", "=C23", "=C23"],
  ['=C16*\'Assumptions\'!$B$10+C17*\'Assumptions\'!$B$11+C18*\'Assumptions\'!$B$12', '=D16*\'Assumptions\'!$B$10+D17*\'Assumptions\'!$B$11+D18*\'Assumptions\'!$B$12', '=E16*\'Assumptions\'!$B$10+E17*\'Assumptions\'!$B$11+E18*\'Assumptions\'!$B$12', '=F16*\'Assumptions\'!$B$10+F17*\'Assumptions\'!$B$11+F18*\'Assumptions\'!$B$12', '=G16*\'Assumptions\'!$B$10+G17*\'Assumptions\'!$B$11+G18*\'Assumptions\'!$B$12', '=H16*\'Assumptions\'!$B$10+H17*\'Assumptions\'!$B$11+H18*\'Assumptions\'!$B$12', '=I16*\'Assumptions\'!$B$10+I17*\'Assumptions\'!$B$11+I18*\'Assumptions\'!$B$12', '=J16*\'Assumptions\'!$B$10+J17*\'Assumptions\'!$B$11+J18*\'Assumptions\'!$B$12', '=K16*\'Assumptions\'!$B$10+K17*\'Assumptions\'!$B$11+K18*\'Assumptions\'!$B$12', '=L16*\'Assumptions\'!$B$10+L17*\'Assumptions\'!$B$11+L18*\'Assumptions\'!$B$12', '=M16*\'Assumptions\'!$B$10+M17*\'Assumptions\'!$B$11+M18*\'Assumptions\'!$B$12', '=N16*\'Assumptions\'!$B$10+N17*\'Assumptions\'!$B$11+N18*\'Assumptions\'!$B$12'],
  ['=C12*C23', '=0', '=0', '=0', '=0', '=0', '=0', '=0', '=0', '=0', '=0', '=0'],
  ['=C13/2*C23', '=D13/2*D23', '=E13/2*E23', '=F13/2*F23', '=G13/2*G23', '=H13/2*H23', '=I13/2*I23', '=J13/2*J23', '=K13/2*K23', '=L13/2*L23', '=M13/2*M23', '=N13/2*N23'],
  ['=IF(C24-C25-C26<0,0,C24-C25-C26)', '=IF(D24-D25-D26<0,0,D24-D25-D26)', '=IF(E24-E25-E26<0,0,E24-E25-E26)', '=IF(F24-F25-F26<0,0,F24-F25-F26)', '=IF(G24-G25-G26<0,0,G24-G25-G26)', '=IF(H24-H25-H26<0,0,H24-H25-H26)', '=IF(I24-I25-I26<0,0,I24-I25-I26)', '=IF(J24-J25-J26<0,0,J24-J25-J26)', '=IF(K24-K25-K26<0,0,K24-K25-K26)', '=IF(L24-L25-L26<0,0,L24-L25-L26)', '=IF(M24-M25-M26<0,0,M24-M25-M26)', '=IF(N24-N25-N26<0,0,N24-N25-N26)'],
  ["=C19*'Assumptions'!$B$36+C20*'Assumptions'!$B$37", "=D19*'Assumptions'!$B$36+D20*'Assumptions'!$B$37", "=E19*'Assumptions'!$B$36+E20*'Assumptions'!$B$37", "=F19*'Assumptions'!$B$36+F20*'Assumptions'!$B$37", "=G19*'Assumptions'!$B$36+G20*'Assumptions'!$B$37", "=H19*'Assumptions'!$B$36+H20*'Assumptions'!$B$37", "=I19*'Assumptions'!$B$36+I20*'Assumptions'!$B$37", "=J19*'Assumptions'!$B$36+J20*'Assumptions'!$B$37", "=K19*'Assumptions'!$B$36+K20*'Assumptions'!$B$37", "=L19*'Assumptions'!$B$36+L20*'Assumptions'!$B$37", "=M19*'Assumptions'!$B$36+M20*'Assumptions'!$B$37", "=N19*'Assumptions'!$B$36+N20*'Assumptions'!$B$37"],
  ["=C28*'Assumptions'!$B$46", "=D28*'Assumptions'!$B$46", "=E28*'Assumptions'!$B$46", "=F28*'Assumptions'!$B$46", "=G28*'Assumptions'!$B$46", "=H28*'Assumptions'!$B$46", "=I28*'Assumptions'!$B$46", "=J28*'Assumptions'!$B$46", "=K28*'Assumptions'!$B$46", "=L28*'Assumptions'!$B$46", "=M28*'Assumptions'!$B$46", "=N28*'Assumptions'!$B$46"],
  ["=C27*'Assumptions'!$B$47+C13*'Assumptions'!$B$48", "=D27*'Assumptions'!$B$47+D13*'Assumptions'!$B$48", "=E27*'Assumptions'!$B$47+E13*'Assumptions'!$B$48", "=F27*'Assumptions'!$B$47+F13*'Assumptions'!$B$48", "=G27*'Assumptions'!$B$47+G13*'Assumptions'!$B$48", "=H27*'Assumptions'!$B$47+H13*'Assumptions'!$B$48", "=I27*'Assumptions'!$B$47+I13*'Assumptions'!$B$48", "=J27*'Assumptions'!$B$47+J13*'Assumptions'!$B$48", "=K27*'Assumptions'!$B$47+K13*'Assumptions'!$B$48", "=L27*'Assumptions'!$B$47+L13*'Assumptions'!$B$48", "=M27*'Assumptions'!$B$47+M13*'Assumptions'!$B$48", "=N27*'Assumptions'!$B$47+N13*'Assumptions'!$B$48"],
  ["=(C19+C20)*'Assumptions'!$B$49", "=(D19+D20)*'Assumptions'!$B$49", "=(E19+E20)*'Assumptions'!$B$49", "=(F19+F20)*'Assumptions'!$B$49", "=(G19+G20)*'Assumptions'!$B$49", "=(H19+H20)*'Assumptions'!$B$49", "=(I19+I20)*'Assumptions'!$B$49", "=(J19+J20)*'Assumptions'!$B$49", "=(K19+K20)*'Assumptions'!$B$49", "=(L19+L20)*'Assumptions'!$B$49", "=(M19+M20)*'Assumptions'!$B$49", "=(N19+N20)*'Assumptions'!$B$49"],
  ["='Assumptions'!$B$42", "='Assumptions'!$B$42", "='Assumptions'!$B$42", "='Assumptions'!$B$42", "='Assumptions'!$B$42", "='Assumptions'!$B$42", "='Assumptions'!$B$42", "='Assumptions'!$B$42", "='Assumptions'!$B$42", "='Assumptions'!$B$42", "='Assumptions'!$B$42", "='Assumptions'!$B$42"],
  ["='Assumptions'!$B$43", "='Assumptions'!$B$43", "='Assumptions'!$B$43", "='Assumptions'!$B$43", "='Assumptions'!$B$43", "='Assumptions'!$B$43", "='Assumptions'!$B$43", "='Assumptions'!$B$43", "='Assumptions'!$B$43", "='Assumptions'!$B$43", "='Assumptions'!$B$43", "='Assumptions'!$B$43"],
  ["='Assumptions'!$B$44", "='Assumptions'!$B$44", "='Assumptions'!$B$44", "='Assumptions'!$B$44", "='Assumptions'!$B$44", "='Assumptions'!$B$44", "='Assumptions'!$B$44", "='Assumptions'!$B$44", "='Assumptions'!$B$44", "='Assumptions'!$B$44", "='Assumptions'!$B$44", "='Assumptions'!$B$44"],
  ["='Assumptions'!$B$45", "='Assumptions'!$B$45", "='Assumptions'!$B$45", "='Assumptions'!$B$45", "='Assumptions'!$B$45", "='Assumptions'!$B$45", "='Assumptions'!$B$45", "='Assumptions'!$B$45", "='Assumptions'!$B$45", "='Assumptions'!$B$45", "='Assumptions'!$B$45", "='Assumptions'!$B$45"],
  ['=SUM(C29:C35)', '=SUM(D29:D35)', '=SUM(E29:E35)', '=SUM(F29:F35)', '=SUM(G29:G35)', '=SUM(H29:H35)', '=SUM(I29:I35)', '=SUM(J29:J35)', '=SUM(K29:K35)', '=SUM(L29:L35)', '=SUM(M29:M35)', '=SUM(N29:N35)'],
  ['=C27-C36', '=D27-D36', '=E27-E36', '=F27-F36', '=G27-G36', '=H27-H36', '=I27-I36', '=J27-J36', '=K27-K36', '=L27-L36', '=M27-M36', '=N27-N36'],
  ['=IF(C27<=0,0,C37/C27)', '=IF(D27<=0,0,D37/D27)', '=IF(E27<=0,0,E37/E27)', '=IF(F27<=0,0,F37/F27)', '=IF(G27<=0,0,G37/G27)', '=IF(H27<=0,0,H37/H27)', '=IF(I27<=0,0,I37/I27)', '=IF(J27<=0,0,J37/J27)', '=IF(K27<=0,0,K37/K27)', '=IF(L27<=0,0,L37/L27)', '=IF(M27<=0,0,M37/M27)', '=IF(N27<=0,0,N37/N27)'],
];
// Re-apply the final margin row explicitly because the artifact API can trim a matrix
// when a preceding row contains a shorter formula payload.
model.getRange('C38:N38').formulas = [[ '=IF(C27<=0,0,C37/C27)', '=IF(D27<=0,0,D37/D27)', '=IF(E27<=0,0,E37/E27)', '=IF(F27<=0,0,F37/F27)', '=IF(G27<=0,0,G37/G27)', '=IF(H27<=0,0,H37/H27)', '=IF(I27<=0,0,I37/I27)', '=IF(J27<=0,0,J37/J27)', '=IF(K27<=0,0,K37/K27)', '=IF(L27<=0,0,L37/L27)', '=IF(M27<=0,0,M37/M27)', '=IF(N27<=0,0,N37/N27)' ]];
model.getRange('C6:N38').format.numberFormat = num; model.getRange('C23:N27').format.numberFormat = won; model.getRange('C29:N38').format.numberFormat = won; model.getRange('C38:N38').format.numberFormat = pct;
model.getRange('A37:N38').format = { fill: green, font: { name: font, size: 10, bold: true, color: '#1F2937' } };

// Overview
baseSheet(overview); title(overview, 'Lecture Notes business model overview');
overview.getRange('A3:B8').values = [
  ['Case selected', "='Assumptions'!B3"],
  ['Month 12 paid customers', "='Monthly Model'!N19"],
  ['Month 12 net revenue', "='Monthly Model'!N27"],
  ['Month 12 operating cost', "='Monthly Model'!N36"],
  ['Month 12 net profit', "='Monthly Model'!N37"],
  ['Month 12 net margin', "='Monthly Model'!N38"],
];
overview.getRange('B4:B8').formulas = overview.getRange('A3:B8').values.slice(1).map(r => [r[1]]);
overview.getRange('B3').values = [['Base']];
overview.getRange('A3:A8').format = { fill: blue, font: { name: font, size: 10, bold: true, color: navy } };
overview.getRange('B3:B8').format = { fill: green, font: { name: font, size: 11, bold: true, color: '#1F2937' } };
overview.getRange('B5:B7').format.numberFormat = won; overview.getRange('B8').format.numberFormat = pct; overview.getRange('B4').format.numberFormat = num;
section(overview, 'A11:E11', 'Unit economics and levers');
overview.getRange('A12:E19').values = [
  ['Question', 'Current model answer', 'Primary lever', 'Where to change', 'Interpretation'],
  ['What drives revenue?', 'Paid customers × plan price', 'Conversion, mix, churn', 'Assumptions rows 15–21, 29–31', 'Acquisition without retention does not compound'],
  ['What drives gross variable cost?', 'Lecture minutes × LLM minute cost', 'Minutes per user, model cost', 'Assumptions rows 36, 46', 'LLM usage is the main variable-cost risk'],
  ['What drives preorder cost?', 'Preorder paid customers × ARPU', 'Waitlist size, conversion', 'Assumptions rows 25, 17', 'First month is a deliberate acquisition subsidy'],
  ['What drives referral cost?', 'Qualified referrals ÷ 2 × ARPU', 'Qualification and cap', 'Assumptions rows 34, 35', 'Keep reward capped until payback is observed'],
  ['What is excluded?', 'Payroll and tax are 0 in base', 'Add actual costs', 'Assumptions rows 51–52', 'Net profit is pre-tax / pre-payroll until updated'],
  ['What to measure next?', 'Funnel and minutes by plan', 'Instrument events', 'Product analytics', 'Replace planning assumptions with actual cohorts'],
  ['Decision rule', 'Run Downside / Base / Upside', 'Case inputs', 'Assumptions yellow cells', 'Do not treat Base as a forecast commitment'],
];
header(overview, 'A12:E12'); overview.getRange('A13:E19').format.wrapText = true;
overview.getRange('G3:H15').values = [
  ['Key offer', 'Modeled treatment'],
  ['14-day trial', 'Up to 200 minutes, Essential/Edu functionality'],
  ['Preorder', 'First paid month free after card registration'],
  ['Referral', 'Two qualified activations unlock one free month'],
  ['Free plan', 'No revenue; active users still create support/LLM load'],
  ['Essential', '21,900원 / month'],
  ['Edu', '12,900원 / month'],
  ['Pro', '28,900원 / month'],
  ['Caution', 'Card billing, VAT, payroll, refunds and annual plans need final policy'],
  ['Research examples', 'See Sources tab for primary pages and implications'],
  ['Use', 'Change yellow cells on Assumptions, then review Overview and Monthly Model'],
  ['Date', '2026-09-23'],
  ['Scope', 'Illustrative planning model, not accounting guidance'],
];
header(overview, 'G3:H3'); overview.getRange('G4:H15').format.wrapText = true;

// Compact visual table: monthly net revenue and net profit. A table keeps the output editable
// in Excel without a fragile drawing object.
overview.getRange('G18:I30').values = [['Month', 'Net revenue', 'Net profit'], ...Array.from({ length: 12 }, (_, i) => [i + 1, null, null])];
overview.getRange('H19:I30').formulas = Array.from({ length: 12 }, (_, i) => [`='Monthly Model'!${String.fromCharCode(67 + i)}27`, `='Monthly Model'!${String.fromCharCode(67 + i)}37`]);
header(overview, 'G18:I18'); overview.getRange('H19:I30').format.numberFormat = won;

// Sources and research log
baseSheet(sources); title(sources, 'Comparable offers and source notes');
sources.getRange('A3:E3').values = [['Service / source', 'Observed offer or condition', 'Modeling implication', 'Source URL', 'Verification note']]; header(sources, 'A3:E3');
sources.getRange('A4:E12').values = [
  ['Shift', 'Founding members lock in 50% off at launch; waitlist CTA and email form', 'Place offer immediately beside the waitlist CTA; state whether it is recurring or first-month only', 'https://shift.satulabs.com/', 'Public landing page; launch offer wording observed'],
  ['atbridge Notes', 'Early-bird price held while subscribed; 14-day trial shown', 'State price-lock duration and trial/card terms separately', 'https://atbridge.ai/notes', 'Public pricing page; exact local currency may vary'],
  ['Heptabase', 'Historical early-bird pricing retained for eligible subscribers under stated conditions', 'If using a founding price, define eligibility and what happens after cancellation', 'https://support.heptabase.com/en/articles/10364311-what-s-early-bird-pricing-and-how-do-i-keep-it', 'Official support document; historical campaign'],
  ['Readwise', '30-day trial; 50% student/academia discount with proof', 'Separate ongoing student discount from temporary preorder incentive', 'https://docs.readwise.io/faqs/subscription', 'Official FAQ'],
  ['EBS eBook', 'Historical first-month 990원 event', 'A concrete first-month price can be clearer than an unexplained percentage', 'https://about.ebs.co.kr/board/bbs?boardTypeId=1&boardId=31&cmd=view&postId=30004730005', 'Official event page; ended offer'],
  ['QANDA Premium', 'Historical 6 months paid + 6 months free bundle', 'Longer bonus periods can increase commitment but defer revenue', 'https://qanda-lab.qanda.ai/', 'Official product/company page; campaign terms may change'],
  ['FastCampus', 'Historical first-100 coupon for selected subscription terms', 'Caps and expiry can bound acquisition subsidy', 'https://fastcampus.co.kr/event_online_subscription_2412', 'Official event page; ended offer'],
  ['Dropbox referral', 'Referral bonus requires signup plus product activation/install', 'Reward a qualified activation, not a bare account creation', 'https://help.dropbox.com/storage-space/earn-space-referring-friends', 'Official help page'],
  ['Working rule', 'This workbook uses 2 qualified referrals = 1 free month, cap 1 month in base', 'Change qualification and cap after payback data is observed', 'Internal modeling assumption', 'Not a sourced market fact'],
];
sources.getRange('A4:E12').format.wrapText = true;
sources.getRange('A14:E18').values = [
  ['Missing data to replace first', 'Why it matters', 'Suggested measurement', 'Owner', 'Status'],
  ['Trial-to-paid by plan', 'Determines revenue conversion', 'Cohort event from trial start to paid invoice', 'Product / growth', 'Input needed'],
  ['Average lecture minutes by plan', 'Drives LLM variable cost', 'Monthly minutes / active paid user', 'Product / finance', 'Input needed'],
  ['LLM cost per minute by model', 'Determines contribution margin', 'Invoice ÷ processed minutes', 'Engineering / finance', 'Input needed'],
  ['Refunds, VAT, payment fee', 'Determines net revenue', 'Finance settlement report', 'Finance', 'Input needed'],
];
header(sources, 'A14:E14'); sources.getRange('A15:E18').format.wrapText = true;

for (const s of [overview, assumptions, model, sources]) {
  s.getRange('A1:Z120').format.verticalAlignment = 'center';
  s.getRange('A1:Z120').format.font = { name: font, size: 10, color: '#1F2937' };
}
// Explicit widths keep the output deterministic across Excel renderers.
overview.getRange('A:A').format.columnWidth = 28; overview.getRange('B:B').format.columnWidth = 18; overview.getRange('C:E').format.columnWidth = 24; overview.getRange('G:G').format.columnWidth = 26; overview.getRange('H:H').format.columnWidth = 38;
assumptions.getRange('A:A').format.columnWidth = 34; assumptions.getRange('B:E').format.columnWidth = 15; assumptions.getRange('G:G').format.columnWidth = 23; assumptions.getRange('H:H').format.columnWidth = 42;
model.getRange('A:A').format.columnWidth = 31; model.getRange('B:B').format.columnWidth = 17; model.getRange('C:N').format.columnWidth = 14;
sources.getRange('A:A').format.columnWidth = 22; sources.getRange('B:C').format.columnWidth = 44; sources.getRange('D:D').format.columnWidth = 54; sources.getRange('E:E').format.columnWidth = 28;
assumptions.freezePanes.freezeRows(9); model.freezePanes.freezeRows(3); sources.freezePanes.freezeRows(3);
wb.recalculate();

const preview = await wb.render({ sheetName: 'Overview', autoCrop: 'all', scale: 1, format: 'png' });
await fs.writeFile(`${outDir}/business-model-overview.png`, new Uint8Array(await preview.arrayBuffer()));
const xlsx = await SpreadsheetFile.exportXlsx(wb);
await xlsx.save(`${outDir}/lecture-notes-business-model.xlsx`);

const inspect = await wb.inspect({ kind: 'region,formula,drawing', sheetId: 'Overview', range: 'A1:N34', maxChars: 6000, options: { maxResults: 40 } });
await fs.writeFile(`${outDir}/business-model-inspect.json`, JSON.stringify(inspect, null, 2));
console.log(JSON.stringify({ output: `${outDir}/lecture-notes-business-model.xlsx`, preview: `${outDir}/business-model-overview.png` }));
