// deliberately wrong for 1.21.1 (KubeJS 7)
onEvent('recipes', event => {
  event.remove({ output: 'minecraft:stick' });
});

StartupEvents.registry('item', event => {
  event.create('test_item');
});

REIEvents.add('item', event => {
  event.add('minecraft:stick', 'Look here');
});

ClientEvents.highPriorityAssets(event => {
  event.add('test:textures/gui/bg.png', new Uint8Array(0));
});

EntityEvents.hurt('minecraft:zombie', event => {
  event.cancel();
});

ServerEvents.recipes(event => {
  event.smithing('minecraft:diamond_pickaxe', 'minecraft:netherite_ingot', 'minecraft:netherite_pickaxe');
  event.shaped('minecraft:chest', ['PPP', 'P P', 'PPP']);
});
