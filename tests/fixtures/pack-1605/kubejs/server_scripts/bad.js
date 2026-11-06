// deliberately modern syntax in a 1.16.5 pack
ServerEvents.recipes(event => {
  event.remove({ output: 'minecraft:stick' });
});

ItemEvents.modification(event => {
  event.modify('minecraft:diamond_sword', item => item.maxDamage = 100);
});

onEvent('invented_event', event => {
  console.log('nope');
});
