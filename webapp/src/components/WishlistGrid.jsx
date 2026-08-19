import GiftCard from "./GiftCard.jsx";

export default function WishlistGrid({ items, isOwner, onBookToggle, onEdit, onDelete }) {
  if (items.length === 0) {
    return (
      <div className="empty-state">
        <span className="emoji">🎁</span>
        {isOwner ? (
          <p>
            Пока пусто. Нажмите «+», чтобы добавить первую вещь по ссылке
            с любимого магазина.
          </p>
        ) : (
          <p>Здесь пока нет подарков.</p>
        )}
      </div>
    );
  }

  return (
    <div className="grid">
      {items.map((item) => (
        <GiftCard
          key={item.id}
          item={item}
          isOwner={isOwner}
          onBookToggle={onBookToggle}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
