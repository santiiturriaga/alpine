// iPadOS can request a desktop user agent. Use the input and screen as well.
export const compactDevice = typeof window !== 'undefined' && (
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches &&
    Math.min(screen.width, screen.height) <= 1024)
);
