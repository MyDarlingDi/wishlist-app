import { useState } from "react";
import { api } from "../api.js";
import { openInvoice, showAlert } from "../telegram.js";

const PRESETS = [5, 15, 50, 100];

export default function GiftStarsModal({ ownerId, onClose }) {
  const [amount, setAmount] = useState(15);
  const [loading, setLoading] = useState(false);

  async function handleSend() {
    setLoading(true);
    try {
      const { invoice_link } = await api.giftStars(ownerId, amount);
      openInvoice(invoice_link, (status) => {
        if (status === "paid") {
          showAlert("Спасибо! Звёзды отправлены 🌟");
          onClose();
        }
      });
    } catch {
      showAlert("Не получилось создать платёж, попробуйте позже");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <p className="modal-title">Подарить звёзды</p>
        <p className="hint-text">
          Звёзды поступят прямо в Telegram-баланс подарков этого человека — видно будет только ему.
        </p>
        <div className="action-row" style={{ flexWrap: "wrap" }}>
          {PRESETS.map((p) => (
            <button
              key={p}
              className={"btn " + (amount === p ? "btn-ribbon" : "btn-ghost")}
              onClick={() => setAmount(p)}
            >
              {p} ⭐
            </button>
          ))}
        </div>
        <button className="btn btn-ribbon btn-block" disabled={loading} onClick={handleSend}>
          {loading ? "Открываем оплату…" : `Подарить ${amount} ⭐`}
        </button>
      </div>
    </div>
  );
}
