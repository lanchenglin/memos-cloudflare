import { API_BASE_URL, getRequestToken, refreshAccessToken } from "@/connect";

/** Bearer-only mutations; cookies are reserved for session refresh and image reads. */
export async function personalFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const perform = async () => {
    const token = await getRequestToken();
    if (!token) throw new Error("请先登录");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(new URL(path, API_BASE_URL), { ...init, headers, credentials: "same-origin" });
  };
  let response = await perform();
  if (response.status === 401) { await refreshAccessToken(); response = await perform(); }
  if (!response.ok) {
    const error = await response.json().catch(() => null) as {message?: string} | null;
    throw new Error(error?.message || `请求失败（${response.status}）`);
  }
  return response;
}
