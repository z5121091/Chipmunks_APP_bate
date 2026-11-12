type PackagingRule = { id: string; packagingFields?: string[] };

type PackageIdentity = [ruleId: string, fields: [field: string, value: string][]];

export const packageFieldValue = (value?: string | null): string => {
  const text = value?.trim() || '';
  return /^(?:-+|—+|–+)$/.test(text) ? '' : text;
};

export const buildPackageKey = (
  rule: PackagingRule,
  fields: Record<string, string>,
  labels: Record<string, string>,
): string | undefined => {
  if (!rule.packagingFields?.length || packageFieldValue(fields.traceNo)) return;
  // A label missing its configured package number keeps the unnumbered workflow.
  if (rule.packagingFields.includes('sourceNo') && !packageFieldValue(fields.sourceNo)) return;

  const parts: PackageIdentity[1] = [...rule.packagingFields].sort().map(field => {
    const value = packageFieldValue(fields[field]);
    if (!value) throw new Error(`包装识别缺少${labels[field] || field}，请核对标签和解析规则`);
    return [field, value];
  });
  return JSON.stringify([rule.id, parts] satisfies PackageIdentity);
};

export const readPackageIdentity = (key: string): PackageIdentity => JSON.parse(key) as PackageIdentity;

export const getSplitPackageKey = (key: string, sourceNo: string, quantity?: number): string => {
  const [ruleId, fields] = readPackageIdentity(key);
  return JSON.stringify([ruleId, fields.filter(([field]) => quantity !== undefined || field !== 'quantity').map(([field, value]) => [field,
    field === 'sourceNo' ? sourceNo : field === 'quantity' ? String(quantity) : value,
  ])] satisfies PackageIdentity);
};

const BOX_LABEL_FIELDS = ['model', 'version', 'package', 'batch', 'quantity', 'productionDate', 'sourceNo'];

/** Mirror the QR layout of the existing templates verified for box suffixes. */
export const buildSplitBoxLabel = (supplier: string, fields: Record<string, string>): string => {
  const values = BOX_LABEL_FIELDS.map(field => fields[field] || '');
  if (supplier === '广东仁懋电子有限公司') {
    const [model, version, ...rest] = values;
    return ['B', version, model, ...rest].join(' ');
  }
  if (supplier === '苏州东微半导体股份有限公司') return `${values.join(';')};`;
  throw new Error('此供应商模板暂不支持按箱号生成拆包标签，请先核对打印模板');
};
