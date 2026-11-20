export function bindPauseTabs(dialog) {
  const tablist = dialog.querySelector('[role="tablist"]');
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
  const body = dialog.querySelector('.pause-body');

  function select(index) {
    if (tabs[index].getAttribute('aria-selected') === 'true') return;
    tabs.forEach((tab, position) => {
      const active = position === index;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      panels[position].hidden = !active;
    });
    body.scrollTop = 0;
  }

  tabs.forEach((tab, index) => tab.addEventListener('click', () => select(index)));
  tablist.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(event.target);
    if (index < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    let next;
    switch (event.key) {
      case 'ArrowLeft': next = (index + tabs.length - 1) % tabs.length; break;
      case 'ArrowRight': next = (index + 1) % tabs.length; break;
      case 'Home': next = 0; break;
      case 'End': next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    select(next);
    tabs[next].focus();
  });
}
