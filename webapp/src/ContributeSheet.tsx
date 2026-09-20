import { useState } from "react";
import { api, errorText, type Wish } from "./api";
import { formatPrice } from "./image";
import { showAlert } from "./telegram";

/** Group-gift dialog: pick or type an amount; can also take a previous share back. */
export function ContributeSheet({ wish, onClose, onChanged }: { wish: Wish; onClose: () => void; onChanged: (w: Wish) => void }) {
  const remaining = wish.remaining ?? 0;
  const presets = [...new Set([500, 1000, 2000, remaining].filter((v) => v > 0 && v <= remaining))].sort((a, b) => a - b);
  const [amount, setAmount] = useState(String(presets[Math.min(1, presets.length - 1)] ?? ""));
  const [busy, setBusy] = useState(false);
  const value = Number(amount);

  async function run(fn: () => Promise<Wish>) {
    setBusy(true);
    try {
      onChanged(await fn());
      onClose();
    } catch (e) {
      showAlert(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <p className="modal-title">Скинуться на «{wish.title}»</p>
        <p className="hint-text">
          Собрано {formatPrice(wish.collected, wish.currency) ?? "0 ₽"} из {formatPrice(wish.price, wish.currency)}
          {remaining > 0 ? `, осталось ${formatPrice(remaining, wish.currency)}` : ""}. Именинник этого не видит.
        </p>
        {remaining > 0 && (
          <>
            <div className="action-row wrap">
              {presets.map((p) => (
                <button key={p} className={`btn ${value === p ? "btn-ribbon" : "btn-ghost"}`} onClick={() => setAmount(String(p))}>
                  {p === remaining && presets.length > 1 ? "Всё: " : ""}
                  {formatPrice(p, wish.currency)}
                </button>
              ))}
            </div>
            <input className="input" inputMode="numeric" placeholder="Своя сумма" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
            <button className="btn btn-ribbon btn-block" disabled={busy || !value || value > remaining} onClick={() => run(() => api.contribute(wish.id, value))}>
              {busy ? "Отправляем…" : `Внести ${value ? formatPrice(value, wish.currency) : ""}`}
            </button>
          </>
        )}
        {!!wish.my_contribution && (
          <button className="btn btn-outline btn-block" disabled={busy} onClick={() => run(() => api.withdraw(wish.id))}>
            Забрать мой взнос ({formatPrice(wish.my_contribution, wish.currency)})
          </button>
        )}
      </div>
    </div>
  );
}
