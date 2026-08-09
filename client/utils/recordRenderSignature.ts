export type RecordRenderSignatureField<TRecord> =
  | keyof TRecord
  | ((record: TRecord) => unknown);

const stringifySignatureValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
};

export const getRecordRenderSignature = <TRecord>(
  records: readonly TRecord[] = [],
  fields: readonly RecordRenderSignatureField<TRecord>[]
): string =>
  records
    .map((record) =>
      fields
        .map((field) =>
          stringifySignatureValue(typeof field === 'function' ? field(record) : record[field])
        )
        .join(':')
    )
    .join('|');
