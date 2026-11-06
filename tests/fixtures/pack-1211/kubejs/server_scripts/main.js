// fixture: a valid modern script
ServerEvents.recipes((event) => {
  event.shaped('minecraft:diamond', ['AAA', 'AAA', 'AAA'], { A: 'minecraft:coal' });
});
