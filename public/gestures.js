export function gestureFromLandmarks(points, threshold = .3) {
  if (!points || points.length !== 21) return null;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const palm = distance(points[0], points[9]);
  if (palm < .015) return null;
  const anchors = [points[0], points[5], points[9], points[13], points[17]];
  const center = anchors.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  const pinchRatio = distance(points[4], points[8]) / palm;
  const isPinch = pinchRatio < threshold;
  const d0 = points[0];
  const indexExt = distance(points[8], d0) > distance(points[6], d0);
  const middleExt = distance(points[12], d0) > distance(points[10], d0);
  const ringExt = distance(points[16], d0) > distance(points[14], d0);
  const pinkyExt = distance(points[20], d0) > distance(points[18], d0);
  const openPalm = indexExt && middleExt && ringExt && pinkyExt && !isPinch;
  const pointing = indexExt && !middleExt && !ringExt && !pinkyExt;
  const tilt = Math.atan2(points[9].y - points[0].y, points[9].x - points[0].x);

  return {
    x: Math.max(0, Math.min(1, (1 - center.x / anchors.length - .12) / .76)),
    y: Math.max(0, Math.min(1, (center.y / anchors.length - .1) / .8)),
    pinch: isPinch,
    pinchDistance: pinchRatio,
    openPalm,
    pointing,
    tilt
  };
}

export function gesturesFromHands(hands, threshold = .3) {
  return hands.map(hand => gestureFromLandmarks(hand, threshold)).filter(Boolean);
}
