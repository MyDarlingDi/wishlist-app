import { shareLink, showAlert } from "../telegram.js";

export default function ShareBar({ link }) {
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      showAlert("Ссылка скопирована — вставьте её в описание профиля или отправьте друзьям");
    } catch {
      showAlert(link);
    }
  }

  return (
    <div className="share-bar">
      <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => shareLink(link, "Мой вишлист 🎁")}>
        Отправить другу
      </button>
      <button className="btn btn-outline" onClick={copyLink}>
        Скопировать ссылку
      </button>
    </div>
  );
}
