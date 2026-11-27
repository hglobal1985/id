// Email 寄送（Cloudflare Email Service 的 send_email 綁定；沒綁定就不寄，站內通知照常）。
export interface Mailer {
  from: string;
  name: string;
  binding: { send(msg: { from: { email: string; name: string }; to: string; subject: string; text: string }): Promise<unknown> };
}

/** 只寄純文字、不放任何 Token 或會員資料。 */
export async function sendMail(m: Mailer, to: string, subject: string, text: string): Promise<void> {
  await m.binding.send({ from: { email: m.from, name: m.name }, to, subject, text });
}
