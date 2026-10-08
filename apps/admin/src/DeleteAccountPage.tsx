import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api.ts';
import { supabase, useSession } from './auth.ts';
import { accountLabel, formatPurgeDate, toE164Vn } from './delete-account.ts';

/**
 * Public account-deletion page (Google Play "delete account" URL). Works without admin access:
 * the parent proves the account with a phone OTP (or Google), then confirms. The same request is
 * available in the app under Quyền riêng tư → Xoá tài khoản.
 */
export function DeleteAccountPage() {
  const { session, loading } = useSession();
  const [phone, setPhone] = useState('');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purgeAfter, setPurgeAfter] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Xoá tài khoản VionX';
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sendCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const e164 = toE164Vn(phone);
      if (!e164) throw new Error('Số điện thoại chưa đúng. / Invalid phone number.');
      const { error: otpError } = await supabase.auth.signInWithOtp({ phone: e164 });
      if (otpError) throw new Error(otpError.message);
      setCodeSentTo(e164);
    });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone: codeSentTo!,
        token: code.trim(),
        type: 'sms',
      });
      if (verifyError)
        throw new Error('Mã OTP chưa đúng hoặc đã hết hạn. / Wrong or expired code.');
    });
  };

  const google = () =>
    void run(async () => {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/delete-account` },
      });
      if (oauthError) throw new Error(oauthError.message);
    });

  const requestDeletion = () =>
    void run(async () => {
      const { data, response } = await api.POST('/api/v1/account/delete-request', {
        body: { confirm: true, source: 'web' },
      });
      if (!data) throw new Error(`Không gửi được yêu cầu (HTTP ${response.status}). Thử lại sau.`);
      setPurgeAfter(data.deletion.purgeAfter);
      await supabase.auth.signOut();
    });

  return (
    <main className="public">
      <div className="card">
        <h1>Xoá tài khoản VionX</h1>
        <p className="muted">Delete your VionX account</p>

        <h2>Điều gì sẽ xảy ra</h2>
        <ul>
          <li>
            Tài khoản phụ huynh và tài khoản đăng nhập của các con bị <strong>khoá ngay</strong>.
          </li>
          <li>
            Sau <strong>30 ngày</strong>, toàn bộ dữ liệu của gia đình (hồ sơ các con, bài làm, tiến
            độ, lựa chọn đồng ý) bị <strong>xoá vĩnh viễn</strong>.
          </li>
          <li>
            Sổ điểm thưởng được ẩn danh hoá thay vì xoá; chỉ giữ lại bản ghi rằng yêu cầu đã được
            thực hiện (không có tên).
          </li>
          <li>
            Trong ứng dụng, bạn cũng có thể làm việc này ở <em>Quyền riêng tư → Xoá tài khoản</em>,
            hoặc chỉ xoá hồ sơ của một con.
          </li>
        </ul>
        <p className="muted">
          Your parent account and your children&apos;s logins are disabled at once; all household
          data is permanently deleted after 30 days (reward ledgers are anonymised). You can also do
          this in the app under Privacy → Delete account.
        </p>

        {purgeAfter ? (
          <p className="ok" role="status" data-testid="deletion-scheduled">
            Đã nhận yêu cầu. Tài khoản đã bị khoá và dữ liệu sẽ bị xoá vĩnh viễn vào ngày{' '}
            {formatPurgeDate(purgeAfter)}. / Request received; data will be deleted on{' '}
            {formatPurgeDate(purgeAfter)}.
          </p>
        ) : loading ? (
          <p className="muted">Đang tải… / Loading…</p>
        ) : session ? (
          <section>
            <h2>Xác nhận / Confirm</h2>
            <p>
              Tài khoản: <strong>{accountLabel(session.user)}</strong>
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
              />{' '}
              Tôi hiểu rằng toàn bộ dữ liệu của gia đình sẽ bị xoá và không thể khôi phục. / I
              understand this cannot be undone.
            </label>
            <div className="actions">
              <button
                type="button"
                className="danger"
                disabled={!understood || busy}
                onClick={requestDeletion}
              >
                {busy ? 'Đang gửi…' : 'Xoá tài khoản / Delete account'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void supabase.auth.signOut()}
              >
                Huỷ / Cancel
              </button>
            </div>
          </section>
        ) : (
          <section>
            <h2>Đăng nhập để xác minh / Sign in to verify</h2>
            {codeSentTo ? (
              <form onSubmit={verify}>
                <label>
                  Mã OTP đã gửi đến {codeSentTo}
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
                <button type="submit" disabled={busy}>
                  Xác nhận / Verify
                </button>
              </form>
            ) : (
              <form onSubmit={sendCode}>
                <label>
                  Số điện thoại / Phone
                  <input
                    type="tel"
                    autoComplete="tel"
                    placeholder="0912 345 678"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
                <button type="submit" disabled={busy}>
                  Gửi mã OTP / Send code
                </button>
              </form>
            )}
            <button type="button" className="secondary" onClick={google}>
              Đăng nhập với Google / Sign in with Google
            </button>
          </section>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
