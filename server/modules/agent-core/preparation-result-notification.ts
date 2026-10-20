function preparationResultNotification(
  resultId: string,
  customerName: string,
  publicUrl?: string,
): { text: string; key: string } {
  let resultLink: string | null = null;
  if (publicUrl) {
    try {
      const base: URL = new URL(`${publicUrl.replace(/\/$/u, '')}/`);
      if (['http:', 'https:'].includes(base.protocol)) {
        resultLink = new URL(`preparations/${encodeURIComponent(resultId)}`, base).toString();
      }
    } catch {
      // A saved result remains accessible by ID when deployment URL configuration is invalid.
      resultLink = null;
    }
  }
  return {
    text: `准备包已生成并保存。客户：${customerName}。${resultLink ? `查看：${resultLink}` : `结果编号：${resultId}（工作台地址尚未配置）`}`,
    key: `preparation-result:${resultId}`,
  };
}

export { preparationResultNotification };
