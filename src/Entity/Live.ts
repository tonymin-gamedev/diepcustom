/*
    DiepCustom - custom tank game server that shares diep.io's WebSocket protocol
    Copyright (C) 2022 ABCxFF (github.com/ABCxFF)

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program. If not, see <https://www.gnu.org/licenses/>
*/

import * as util from "../util";

import ObjectEntity from "./Object";
import TankBody from "./Tank/TankBody";

import { visibilityRateDamage } from "../Const/TankDefinitions";
import { StyleFlags } from "../Const/Enums";
import { HealthGroup } from "../Native/FieldGroups";
import Bullet from "./Tank/Projectile/Bullet";

/**
 * An Abstract class for all entities with health.
 */
export default class LivingEntity extends ObjectEntity {
    /** Always existant health field group, present on all entities with a healthbar. */
    public health: HealthGroup = new HealthGroup(this);

    /** The points a player is awarded when it kills this entity. */
    public scoreReward = 0;
    /** Amount of health gained per tick. */
    protected regenPerTick = 0;
    /** The damage this entity can emit onto another per tick. */
    protected damagePerTick = 8;
    /** Entities who have went through damage cycles with this entity in the past tick. No repeats. */
    protected damagedEntities: LivingEntity[] = [];
    /** Last tick that damage was received. */
    protected lastDamageTick = -1;
    /** Damage reduction (mathematical health increase). */
    protected damageReduction = 1;

    /** Extends ObjectEntity.destroy() - diminishes health as well. */
    public destroy(animate=true) {
        if (this.hash === 0) return; // already deleted;
        
        if (animate) this.health.health = 0;

        super.destroy(animate);
    }

    /** Applies damage to two entity after colliding with eachother. */
    protected static applyDamage(entity1: LivingEntity, entity2: LivingEntity) {
        if (entity1.health.values.health <= 0 || entity2.health.values.health <= 0) return;
        if (entity1.damagedEntities.includes(entity2) || entity2.damagedEntities.includes(entity1)) return;
        if ((entity1.style.values.styleFlags & StyleFlags.invincibility) && (entity2.style.values.styleFlags & StyleFlags.invincibility)) return;

        const game = entity1.game;

        // entity2.lastDamageTick = entity1.lastDamageTick = entity1.game.tick;

        let dF1 = entity1.damagePerTick * entity2.damageReduction;
        let dF2 = entity2.damagePerTick * entity1.damageReduction;

        if (entity1 instanceof TankBody && entity2 instanceof TankBody) {
            dF1 *= 1.5;
            dF2 *= 1.5;
        }

        // Damage can't be more than enough to kill health
        const ratio = Math.max(1 - entity1.health.values.health / dF2, 1 - entity2.health.values.health / dF1)
        if (ratio > 0) { // Or >=, but minor optimizations
            dF1 *= 1 - ratio;
            dF2 *= 1 - ratio;
        }

        if (entity1.style.values.styleFlags & StyleFlags.invincibility) dF2 = 0;
        if (entity2.style.values.styleFlags & StyleFlags.invincibility) dF1 = 0;

        if (dF1 !== 0) {
            if (entity2.lastDamageTick !== game.tick && !(entity2.style.values.styleFlags & StyleFlags.noDmgIndicator)) entity2.style.styleFlags ^= StyleFlags.damage;
            if (entity2.lastDamageTick !== game.tick && entity2 instanceof TankBody && entity2.definition.flags.invisibility && entity2.style.values.opacity < visibilityRateDamage) entity2.style.opacity += visibilityRateDamage;
            entity2.lastDamageTick = game.tick;
            entity2.health.health -= dF1;
        }
        if (dF2 !== 0) {
            if (entity1.lastDamageTick !== game.tick && !(entity1.style.values.styleFlags & StyleFlags.noDmgIndicator)) entity1.style.styleFlags ^= StyleFlags.damage;
            if (entity1.lastDamageTick !== game.tick && entity1 instanceof TankBody && entity1.definition.flags.invisibility && entity1.style.values.opacity < visibilityRateDamage) entity1.style.opacity += visibilityRateDamage;
            entity1.lastDamageTick = game.tick;
            entity1.health.health -= dF2;
        }
        entity1.damagedEntities.push(entity2)
        entity2.damagedEntities.push(entity1)

        if (entity1.health.values.health < -0.0001) {
            util.warn("Health is below 0. Something in damage messed up]: ", entity1.health.health, entity2.health.health, ratio, dF1, dF2);
        }
        if (entity2.health.values.health < -0.0001) {
            util.warn("Health is below 0. Something in damage messed up]: ", entity1.health.health, entity2.health.health, ratio, dF1, dF2);
        }

        if (entity1.health.values.health < 0.0001) entity1.health.health = 0;
        if (entity2.health.values.health < 0.0001) entity2.health.health = 0;

        if (entity1.health.values.health === 0) {
            let killer: ObjectEntity = entity2;
            while (killer.relations.values.owner instanceof ObjectEntity && killer.relations.values.owner.hash !== 0) killer = killer.relations.values.owner;
            if (killer instanceof LivingEntity) entity1.onDeath(killer);
            entity2.onKill(entity1);
        }
        if (entity2.health.values.health === 0) {
            let killer: ObjectEntity = entity1;
            while (killer.relations.values.owner instanceof ObjectEntity && killer.relations.values.owner.hash !== 0) killer = killer.relations.values.owner;
            
            if (killer instanceof LivingEntity) entity2.onDeath(killer);
            entity1.onKill(entity2);
        }
    }

    /** Called when the entity kills another via collision. */
    public onKill(entity: LivingEntity) {}

    /** Called when the entity is killed via collision */
    public onDeath(killer: LivingEntity) {}

    /** Runs at the end of each tick. Will apply the damage then. */
    public applyPhysics() {
        super.applyPhysics();

        if (this.health.values.health <= 0) {
            this.destroy(true);

            this.damagedEntities = [];
            return;
        }

        // Regeneration
        if (this.health.values.health < this.health.values.maxHealth) {
            this.health.health += this.regenPerTick;

            // Regen boost after 30s
            if (this.game.tick - this.lastDamageTick >= 750) {
                this.health.health += this.health.values.maxHealth / 250;
            }
        }

        if (this.health.values.health > this.health.values.maxHealth) {
            this.health.health = this.health.values.maxHealth;
        }

        this.damagedEntities = [];
    }

    public tick(tick: number) {
        super.tick(tick);
        
        // It's cached
        const collidedEntities = this.findCollisions();

        for (let i = 0; i < collidedEntities.length; ++i) {
            if (!(collidedEntities[i] instanceof LivingEntity)) continue;

            if (collidedEntities[i].relations.values.team !== this.relations.values.team) {
                LivingEntity.applyDamage(collidedEntities[i] as LivingEntity, this);
            }
        }
    }
}