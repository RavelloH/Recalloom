/**
 * The OAuth consent form POSTs back to /authorize on this origin.
 * OAuth redirect_uri is followed by an HTTP 302 after authorization;
 * it is not a form submission and must not be listed in form-action.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, ch => '&#' + ch.charCodeAt(0) + ';');
}

export function page(title: string, body: string, status = 200): Response {
  return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
    + escapeHtml(title) + '</title><style>body{max-width:660px;margin:8vh auto;padding:0 20px;font:16px/1.6 system-ui;color:#202635}main{padding:28px;border:1px solid #d1d7e0;border-radius:14px}input{font:inherit;padding:10px;width:95%;margin:10px 0}button{font:inherit;padding:10px 20px;margin-right:8px;cursor:pointer}</style><main>'+body+'</main></html>',{
    status,headers:{
      'content-type':'text/html; charset=utf-8',
      'cache-control':'no-store',
      'x-content-type-options':'nosniff',
      'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'referrer-policy':'no-referrer'
    }
  });
}
