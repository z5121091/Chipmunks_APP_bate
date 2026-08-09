import { selectLatestOrderUnpackRecords } from '../unpackRecords';

describe('latest unpack order selection', () => {
  it('keeps every label from the latest order and warehouse only', () => {
    const records = [
      { id: 'latest-shipped', order_no: 'IO-2026-07-25-001', warehouse_id: 'wuxi' },
      { id: 'latest-remaining', order_no: ' IO-2026-07-25-001 ', warehouse_id: 'wuxi' },
      { id: 'same-order-other-warehouse', order_no: 'IO-2026-07-25-001', warehouse_id: 'shanghai' },
      { id: 'older-order', order_no: 'IO-2026-07-24-009', warehouse_id: 'wuxi' },
    ];

    expect(selectLatestOrderUnpackRecords(records).map((record) => record.id)).toEqual([
      'latest-shipped',
      'latest-remaining',
    ]);
  });

  it('returns no records when the latest row has no order number', () => {
    expect(selectLatestOrderUnpackRecords([{ order_no: ' ', warehouse_id: 'wuxi' }])).toEqual([]);
  });
});
