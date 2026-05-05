// 动态获取 API 地址
export function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL || '/api/v1';
}

export function getApiUrl(path: string): string {
  const base = getApiBase();
  if (/^https?:\/\//i.test(base)) {
    return new URL(path, base.endsWith('/') ? base : `${base}/`).toString();
  }
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${normalizedBase}${path}`;
}

// API 请求封装
export async function apiFetch(path: string, options: RequestInit = {}) {
  const base = getApiBase();
  const url = `${base}${path}`;
  
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  
  const config: RequestInit = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  };

  const res = await fetch(url, config);
  
  // 2xx 成功响应（200 OK, 201 Created, 204 No Content 等）
  if (res.status >= 200 && res.status < 300) {
    const text = await res.text();
    if (!text) return { success: true };
    try { return JSON.parse(text); } catch { return { success: true }; }
  }
  
  // 错误状态码
  const text = await res.text();
  if (!text) throw new Error(`请求失败: ${res.status}`);
  try {
    const data = JSON.parse(text);
    throw new Error(data.error || `请求失败: ${res.status}`);
  } catch (e: any) {
    throw new Error(e.message || `请求失败: ${res.status}`);
  }
}
