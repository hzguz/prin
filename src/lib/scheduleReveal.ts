/** Hidden webviews may suspend animation frames. Always allow reveal to proceed quickly. */
export function scheduleReveal(reveal: () => void): () => void {
  let finished = false;
  let frame = 0;
  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    reveal();
  };
  const timer = setTimeout(finish, 4);
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(finish);
  });
  return () => {
    finished = true;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}
