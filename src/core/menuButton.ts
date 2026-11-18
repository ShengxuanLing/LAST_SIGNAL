import type Phaser from 'phaser';

type MenuControl = Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text;

/** Share one action between the canvas hit area and its native keyboard control. */
export function bindMenuButton(scene: Phaser.Scene, control: MenuControl, label: string,
  activate: () => void, disabled = false): HTMLButtonElement {
  control.on('pointerdown', activate);
  const bounds = control.getBounds();
  const button = document.createElement('button');
  button.type = 'button';
  button.disabled = disabled;
  button.setAttribute('aria-label', label);
  Object.assign(button.style, {
    width: bounds.width + 'px', height: bounds.height + 'px', boxSizing: 'border-box',
    padding: '0', border: '0', background: 'transparent', outline: 'none'
  });
  button.addEventListener('focus', () => { button.style.outline = '3px solid #e8e2d0'; });
  button.addEventListener('blur', () => { button.style.outline = 'none'; });
  // Phaser captures Space for dashing. Let a focused button handle its own activation.
  const keepActivation = (event: KeyboardEvent) => {
    if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
  };
  button.addEventListener('keydown', keepActivation);
  button.addEventListener('keyup', keepActivation);
  button.addEventListener('click', activate);
  scene.add.dom(bounds.centerX, bounds.centerY, button).pointerEvents = 'none';
  return button;
}
