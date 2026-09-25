import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, readLine, expandReceiptName, matchReceiptLine, receiptPriceSpec } from '../js/receipt.js';

const HT = `HARRIS TEETER #0123
1201 East Blvd, Charlotte NC
09/24/2026 5:42 PM
HT BNLS SKNLS CHKN THGH   7.84 F
BANANAS
  2.14 lb @ 0.59 /lb       1.26 F
GV WHL MLK GAL            3.49 F
2 @ 1.99
BLACK BEANS               3.98 F
ORG BABY SPINACH 5OZ      3.99 F
PAPER TOWELS 6PK          8.99 T
HT VIC SAVINGS            1.00-
SUBTOTAL                 28.55
TAX                       0.78
TOTAL                    29.33
VISA                     29.33
CHANGE                    0.00
THANK YOU FOR SHOPPING`;

test('receipt lines: money at the end, flags, OCR slips', () => {
  assert.deepEqual(readLine('BANANAS 1.26 F'), { line: 'BANANAS 1.26 F', name: 'BANANAS', amount: 1.26, negative: false });
  assert.equal(readLine('MILK $3.49').amount, 3.49);
  assert.equal(readLine('EGGS 3,99').amount, 3.99);         // comma decimal
  assert.equal(readLine('BREAD 2.O9').amount, 2.09);        // letter O for zero
  assert.equal(readLine('COUPON 1.00-').negative, true);
  assert.equal(readLine('THANK YOU'), null);
});

test('parses items, weights, quantities, totals, tax, store and date', () => {
  const r = parseReceipt(HT);
  assert.equal(r.store, 'HARRIS TEETER #0123');
  assert.equal(r.date, '2026-09-24');
  assert.equal(r.total, 29.33);
  assert.equal(r.subtotal, 28.55);
  assert.equal(r.tax, 0.78);
  assert.equal(r.discounts, 1);
  assert.deepEqual(r.lines.map(l => [l.name, l.amount]), [
    ['HT BNLS SKNLS CHKN THGH', 7.84], ['BANANAS', 1.26], ['GV WHL MLK GAL', 3.49], ['BLACK BEANS', 3.98], ['ORG BABY SPINACH 5OZ', 3.99], ['PAPER TOWELS 6PK', 8.99],
  ]);
  const bananas = r.lines[1];
  assert.deepEqual([bananas.qty, bananas.unit, bananas.unitPrice], [2.14, 'lb', 0.59]);
  const beans = r.lines[3];
  assert.deepEqual([beans.qty, beans.unit, beans.unitPrice], [2, '', 1.99]); // "2 @ 1.99" printed above the item
  assert.equal(r.lines[2].unitPrice, undefined); // ...not the milk above it
});

test('other layouts: inline quantities, weight after the item, no total line', () => {
  const r = parseReceipt('KROGER\nAPPLES 3.98\n2.00 lb @ 1.99/lb\nKALE 2 @ 2.49 4.98\n0000004011 BANANA .89\nLIMES 3 @ .50 1.50\nTax 0.12');
  assert.deepEqual(r.lines.map(l => [l.name, l.amount, l.qty ?? null, l.unitPrice ?? null]), [
    ['APPLES', 3.98, 2, 1.99], ['KALE', 4.98, 2, 2.49], ['BANANA', 0.89, null, null], ['LIMES', 1.5, 3, 0.5],
  ]);
  assert.equal(r.total, Math.round((3.98 + 4.98 + 0.89 + 1.5 + 0.12) * 100) / 100); // worked out when missing
  assert.equal(parseReceipt('').lines.length, 0);
  assert.equal(parseReceipt('Whole Foods\n2026-09-20\nAVOCADO 1.25').date, '2026-09-20');
});

test('receipt names expand and match your list first', () => {
  assert.equal(expandReceiptName('HT BNLS SKNLS CHKN THGH'), 'boneless skinless chicken thigh');
  assert.equal(expandReceiptName('GV WHL MLK GAL'), 'whole milk gallon');
  assert.equal(expandReceiptName('ORG BABY SPINACH 5OZ'), 'baby spinach');
  const list = ['Chicken thighs', 'Milk', 'Limes'];
  assert.deepEqual([matchReceiptLine('HT BNLS SKNLS CHKN THGH', list).name, matchReceiptLine('HT BNLS SKNLS CHKN THGH', list).source], ['Chicken thighs', 'list']);
  assert.equal(matchReceiptLine('GV WHL MLK GAL', list).name, 'Milk');
  const beans = matchReceiptLine('BLACK BEANS', list);
  assert.deepEqual([beans.name, beans.source], ['Black bean', 'estimate']);
  assert.equal(matchReceiptLine('XQZT 44', list).source, 'none');
});

test('what gets saved as "your price" for each line', () => {
  const r = parseReceipt(HT);
  const spec = i => { const l = r.lines[i]; return receiptPriceSpec(l, matchReceiptLine(l.name).entry); };
  assert.deepEqual(spec(1), { price: 0.59, qty: 1, unit: 'lb' });            // bananas by weight
  assert.deepEqual(spec(3), { price: 1.99, qty: 1, unit: '' });              // 2 @ 1.99 -> each
  assert.deepEqual(spec(2), { price: 3.49, qty: 1, unit: 'gallon' });        // milk: the usual package
  assert.deepEqual(spec(4), { price: 3.99, qty: 5, unit: 'oz' });            // spinach 5 oz bag
  const chicken = spec(0);                                                  // by the pound, no weight printed
  assert.equal(chicken.unit, 'lb'); assert.equal(chicken.inferred, true); assert.equal(chicken.price, 7.84);
  assert.equal(chicken.qty, 2.5); // 7.84 / 2.99 ≈ 2.6 lb, rounded to the quarter
  assert.deepEqual(receiptPriceSpec({ amount: 4.5 }, null), { price: 4.5, qty: 1, unit: '' });
});
