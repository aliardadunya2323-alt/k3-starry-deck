import {ShipCollider} from './src/world/collision.js';
import {SHIP} from './src/config.js';

export class DeckCollider extends ShipCollider {
  resolve(position,radius,options){
    position.z=Math.min(position.z,SHIP.poop.wallZ-radius-.1);
    const ground=super.resolve(position,radius,options);
    position.z=Math.min(position.z,SHIP.poop.wallZ-radius-.1);
    return ground;
  }
}
