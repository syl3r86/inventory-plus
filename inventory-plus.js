/**
 * @author Felix Müller aka syl3r86
 */

import ActorSheet5eCharacter from "../../systems/dnd5e/module/actor/sheets/character.js";

class InventoryPlus {
    
    static replaceGetData() {
        let oldGetData = ActorSheet5eCharacter.prototype.getData;

        ActorSheet5eCharacter.prototype.getData = function () {
            let app = this;
            let actor = this.actor;

            let data = oldGetData.bind(this)();
            let newInventory = InventoryPlus.processInventory(app, actor, data.inventory);
            data.inventory = newInventory;

            data.data.attributes.encumbrance.value = InventoryPlus.calculateWeight(data.inventory);
            data.data.attributes.encumbrance.pct = data.data.attributes.encumbrance.value / data.data.attributes.encumbrance.max * 100;
            return data;
        }
    }

    replaceOnDrop() {
        if (this.oldOnDrop === undefined) {
            this.oldOnDrop = ActorSheet5eCharacter.prototype._onDrop;
        }
        let oldOnDrop = this.oldOnDrop;
        ActorSheet5eCharacter.prototype._onDrop = async function (event) {
            // TODO: implement category drag'n'drop
            return oldOnDrop.bind(this)(event);
        }
    }

    replaceOnDropItem() {
        if (this.oldOnDropItem === undefined) {
            this.oldOnDropItem = ActorSheet5eCharacter.prototype._onDropItem;
        }
        let oldOnDropItem = this.oldOnDropItem;
        ActorSheet5eCharacter.prototype._onDropItem = async function (event, data) {
            // dropping new item
            if (data.actorId !== this.object.id || data.data === undefined) {
                return oldOnDropItem.bind(this)(event, data);
            }

            // droping item outside inventory list
            let targetLi = $(event.toElement).parents('li')[0];
            if (targetLi === undefined || targetLi.className === undefined) {
                return oldOnDropItem.bind(this)(event, data);
            }

            // doing actual stuff!!!
            let id = data.data._id;
            let dropedItem = this.object.getOwnedItem(id);
            
            let targetType = '';
            if (targetLi.className.trim() === 'inventory-header flexrow') {
                targetType = $(targetLi).find('.item-control')[0].dataset.type;
            } else if (targetLi.className.trim() == 'item flexrow') {
                let itemId = targetLi.dataset.itemId;
                let item = this.object.getOwnedItem(itemId);
                targetType = InventoryPlus.getItemType(item.data);
            }

            // changing item list
            let itemType = InventoryPlus.getItemType(data);
            if (itemType !== targetType) {
                await dropedItem.update({ 'flags.inventory-plus.category': targetType });
                itemType = targetType;
            }

            // reordering items

            // Get the drag source and its siblings
            let source = dropedItem;
            let siblings = this.object.items.filter(i => {
                let type = InventoryPlus.getItemType(i.data);
                return (type === itemType) && (i.data._id !== source.data._id)
            });
            // Get the drop target
            let dropTarget = event.target.closest(".item");
            let targetId = dropTarget ? dropTarget.dataset.itemId : null;
            let target = siblings.find(s => s.data._id === targetId);

            // Perform the sort
            let sortUpdates = SortingHelpers.performIntegerSort(dropedItem, { target: target, siblings });
            let updateData = sortUpdates.map(u => {
                let update = u.update;
                update._id = u.target.data._id;
                return update;
            });

            // Perform the update
            this.object.updateEmbeddedEntity("OwnedItem", updateData);
        }
    }
    
    static processInventory(app, actor, inventory) {

        if (app.inventoryPlus === undefined) {
            app.inventoryPlus = new InventoryPlus();
            app.inventoryPlus.init(actor);
        }
        return app.inventoryPlus.prepareInventory(inventory);
    }

    init(actor, inventory) {
        this.actor = actor;
        this.initCategorys();
        //this.replaceOnDrop();
        this.replaceOnDropItem();
    }

    initCategorys() {
        let actorFlag = this.actor.getFlag('inventory-plus', 'categorys');
        if (actorFlag === undefined) {
            this.customCategorys = {
                weapon: { label: "DND5E.ItemTypeWeaponPl", dataset: { type: "weapon" }, sortFlag: 1000, ignoreWeight: false },
                equipment: { label: "DND5E.ItemTypeEquipmentPl", dataset: { type: "equipment" }, sortFlag: 2000, ignoreWeight: false },
                consumable: { label: "DND5E.ItemTypeConsumablePl", dataset: { type: "consumable" }, sortFlag: 3000, ignoreWeight: false },
                tool: { label: "DND5E.ItemTypeToolPl", dataset: { type: "tool" }, sortFlag: 4000, ignoreWeight: false },
                backpack: { label: "DND5E.ItemTypeContainerPl", dataset: { type: "backpack" }, sortFlag: 5000, ignoreWeight: false },
                loot: { label: "DND5E.ItemTypeLootPl", dataset: { type: "loot" }, sortFlag: 6000, ignoreWeight: false }
            };
        } else {
            this.customCategorys = duplicate(actorFlag);
            this.applySortKey();
        }
    }

    addInventoryFunctions(html) {
        /*
         *  create custom category 
         */
        let addCategoryBtn = $('<a class="custom-category"><i class="fas fa-plus"></i> Add Custom Category</a>').click(ev => {
            let d = new Dialog({
                title: "Creating new Inventory Category",
                content: '<div class="inv-plus-dialog">New Category Name: <input class="cat-name" type="text"></br></div>',
                buttons: {
                    accept: {
                        icon: '<i class="fas fa-check"></i>',
                        label: "Accept",
                        callback: async html => {
                            let input = html.find('input')[0].value;
                            this.createCategory(input);
                        }
                    },
                    cancle: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancel"
                    }
                },
                default: "accept",
            });
            d.render(true);
        });
        html.find('.inventory .filter-list').prepend(addCategoryBtn);

        /*
         *  add removal function
         */

        let createBtns = html.find('.inventory .item-create');
        for (let createBtn of createBtns) {
            let type = createBtn.dataset.type;
            if (['weapon', 'equipment', 'consumable', 'tool', 'backpack', 'loot'].indexOf(type) === -1) {
                let parent = createBtn.parentNode;
                let removeCategoryBtn = $(`<a class="item-control remove-category" title="Delete Category" data-type="${type}"><i class="fas fa-minus"></i> Del.</a>`);
                removeCategoryBtn.click(ev => this.removeCategory(ev));
                parent.innerHTML = '';
                $(parent).append(removeCategoryBtn);
            }
        }

        /*
         *  add extra header functions
         */
        let headers = html.find('.inventory .inventory-header');
        for (let header of headers) {
            header = $(header);
            let type = header.find('.item-control')[0].dataset.type;

            let extraStuff = $('<div class="inv-plus-stuff flexrow"></div>');
            header.find('h3').after(extraStuff);

            if (this.customCategorys[type] === undefined) {
                return;
            }
            // ignore weight
            let useWeightSelected = this.customCategorys[type].ignoreWeight !== false ? 'checked' : '';
            let useWeightBtn = $(`<div class="flexrow"><input class="ignore-weight" type="checkbox" ${useWeightSelected} data-type="${type}"> ignore Weight</div>`).click(ev => {
                let ignoreWeight = ev.target.checked;
                let type = ev.target.dataset.type;
                if (type) {
                    this.customCategorys[type].ignoreWeight = ignoreWeight;
                    this.saveCategorys();
                }
            });
            extraStuff.append(useWeightBtn);


            // reorder category
            if (this.getLowestSortFlag() !== this.customCategorys[type].sortFlag) {
                let upBtn = $(`<a class="inv-plus-stuff shuffle-up" title="Move category up"><i class="fas fa-chevron-up"></i></a>`).click(() => this.changeCategoryOrder(type, true));
                extraStuff.append(upBtn);
            }
            if (this.getHighestSortFlag() !== this.customCategorys[type].sortFlag) {
                let downBtn = $(`<a class="inv-plus-stuff shuffle-down" title="Move category down"><i class="fas fa-chevron-down"></i></a>`).click(() => this.changeCategoryOrder(type, false));
                extraStuff.append(downBtn);
            }

            // hide by default
            /*header.hover(evIn => {
                $(evIn.target).find('.inv-plus-stuff').show();
            }, evOut => {
                $(evOut.target).find('.inv-plus-stuff').hide();
            });*/
        }
    }

    prepareInventory(inventory) {
        let sections = duplicate(this.customCategorys);

        for (let id in sections) {
            sections[id].items = [];
        }

        for (let section of inventory) {
            for (let item of section.items) {
                let type = InventoryPlus.getItemType(item);
                /*if (sections[type] === undefined) {
                    type = item.type;
                }*/
                sections[type].items.push(item);
            }
        }

        // sort items within sections
        for (let id in sections) {
            let section = sections[id];
            section.items.sort((a, b) => {
                return a.sort - b.sort;
            });
        }
        return sections;
    }

    createCategory(title) {
        if (title === undefined || title === '') {
            ui.notifications.error('Could not create Category as no name was specified');
            return;
        }
        if (title.match(/^\d+$/)) {
            ui.notifications.error('Could not create Category as the name has only numbers');
            return;
        }
        let key = title.replace(/[^一-龠ぁ-ゔァ-ヴーa-zA-Z0-9ａ-ｚＡ-Ｚ０-９々〆〤]/g, '').replace("'", '').replace(/ /g, '');

        if (key === undefined) {
            ui.notifications.error('Could not create Category as the name is invalid');
            return;
        }

        if (this.customCategorys[key] !== undefined) {
            ui.notifications.error(`Could not create Category as a Category with the same key. ${key} already exists.`);
            return;
        }

        let category = {
            label: title,
            dataset: { type: key },
            sortFlag: this.getHighestSortFlag() + 1000,
            ignoreWeight: false
        }

        this.customCategorys[key] = category;
        this.saveCategorys();
    }

    async removeCategory(ev) {
        let catType = ev.target.dataset.type;
        let changedItems = [];
        for (let item of this.actor.items) {
            let type = InventoryPlus.getItemType(item.data);
            if (type === catType) {
                //await item.unsetFlag('inventory-plus', 'category');
                changedItems.push({
                    _id: item.id,
                    '-=flags.inventory-plus':null
                })
            }
        }
        await this.actor.updateEmbeddedEntity('OwnedItem', changedItems);

        delete this.customCategorys[catType];
        let deleteKey = `-=${catType}`
        this.actor.setFlag('inventory-plus', 'categorys', { [deleteKey]:null });
    }

    changeCategoryOrder(movedType, up) {
        let targetType = movedType;
        let currentSortFlag = 0;
        if(!up) currentSortFlag = 999999999;
        for (let id in this.customCategorys) {
            let currentCategory = this.customCategorys[id];
            if (up) {
                if (id !== movedType && currentCategory.sortFlag < this.customCategorys[movedType].sortFlag && currentCategory.sortFlag > currentSortFlag) {
                    targetType = id;
                    currentSortFlag = currentCategory.sortFlag;
                }
            } else {
                if (id !== movedType && currentCategory.sortFlag > this.customCategorys[movedType].sortFlag && currentCategory.sortFlag < currentSortFlag) {
                    targetType = id;
                    currentSortFlag = currentCategory.sortFlag;
                }
            }
        } 

        if (movedType !== targetType) {
            let oldMovedSortFlag = this.customCategorys[movedType].sortFlag;
            let newMovedSortFlag = currentSortFlag;

            this.customCategorys[movedType].sortFlag = newMovedSortFlag;
            this.customCategorys[targetType].sortFlag = oldMovedSortFlag;
            this.applySortKey();
            this.saveCategorys();
        }
    }

    applySortKey() {
        let sortedCategorys = {};

        let keys = Object.keys(this.customCategorys);
        keys.sort((a, b) => {
            return this.customCategorys[a].sortFlag - this.customCategorys[b].sortFlag;
        });
        for (let key of keys) {
            sortedCategorys[key] = this.customCategorys[key];
        }
        this.customCategorys = sortedCategorys;
    }

    getHighestSortFlag() {
        let highest = 0;

        for (let id in this.customCategorys) {
            let cat = this.customCategorys[id];
            if (cat.sortFlag > highest) {
                highest = cat.sortFlag;
            }
        }

        return highest;
    }

    getLowestSortFlag() {
        let lowest = 999999999;

        for (let id in this.customCategorys) {
            let cat = this.customCategorys[id];
            if (cat.sortFlag < lowest) {
                lowest = cat.sortFlag;
            }
        }

        return lowest;
    }

    static getItemType(item) {
        let type = getProperty(item, 'flags.inventory-plus.category');
        if (type === undefined) {
            type = item.type;
        }
        return type;
    }

    static calculateWeight(inventory) {
        let customWeight = 0;
        for (let id in inventory) {
            let section = inventory[id];
            if (section.ignoreWeight !== true) {
                for (let i of section.items) {
                    customWeight += i.data.weight;
                }
            }
        }
        return customWeight;
    }

    async saveCategorys() {
        //this.actor.update({ 'flags.inventory-plus.categorys': this.customCategorys }).then(() => { console.log(this.actor.data.flags) });
        await this.actor.setFlag('inventory-plus', 'categorys', this.customCategorys);
    }
}

Hooks.on('ready', () => {
    InventoryPlus.replaceGetData();
});

Hooks.on(`renderActorSheet5eCharacter`, (app, html, data) => {
    app.inventoryPlus.addInventoryFunctions(html);
});