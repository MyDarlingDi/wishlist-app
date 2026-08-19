export default function ProfileHeader({ owner, starsBalance, isOwner }) {
  const name = [owner.first_name, owner.last_name].filter(Boolean).join(" ") || "Без имени";
  const initial = (owner.first_name || "?").charAt(0).toUpperCase();

  return (
    <div className="profile-card">
      {owner.photo_url ? (
        <img className="profile-avatar" src={owner.photo_url} alt={name} />
      ) : (
        <div className="profile-avatar">{initial}</div>
      )}
      <div className="profile-info" style={{ flex: 1 }}>
        <p className="profile-name">{name}</p>
        {owner.birthdate && <p className="profile-meta">🎂 {owner.birthdate}</p>}
        {owner.bio && <p className="profile-bio">{owner.bio}</p>}
      </div>
      {isOwner && typeof starsBalance === "number" && (
        <span className="stars-pill" title="Видно только вам">
          ⭐ {starsBalance}
        </span>
      )}
    </div>
  );
}
