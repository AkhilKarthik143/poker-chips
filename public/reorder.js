/* global window */
window.SeatOrder = Object.freeze({
  moveItem(order, from, to) {
    if (!Array.isArray(order) || from < 0 || to < 0 || from >= order.length || to >= order.length || from === to) return [...order];
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  },
  reconcileOrder(draft, serverOrder) {
    const live = new Set(serverOrder);
    const next = draft.filter(id => live.has(id));
    for (const id of serverOrder) if (!next.includes(id)) next.push(id);
    return next;
  }
});
