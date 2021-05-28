/**
 * @author Felix Müller aka syl3r86
 */

import ActorSheet5eCharacter from "../../systems/dnd5e/module/actor/sheets/character.js";

class InventoryPlus {
  static replaceGetData() {
    const oldGetData = ActorSheet5eCharacter.prototype.getData;

    ActorSheet5eCharacter.prototype.getData = function () {
      const app = this;
      const actor = this.actor;

      const data = oldGetData.bind(this)();
      const newInventory = InventoryPlus.processInventory(
        app,
        actor,
        data.inventory
      );
      data.inventory = newInventory;

      data.data.attributes.encumbrance.value = InventoryPlus.calculateWeight(
        data.inventory,
        actor.data.data.currency
      );
      data.data.attributes.encumbrance.pct =
        (data.data.attributes.encumbrance.value /
          data.data.attributes.encumbrance.max) *
        100;
      return data;
    };
  }

  replaceOnDrop() {
    if (this.oldOnDrop === undefined) {
      this.oldOnDrop = ActorSheet5eCharacter.prototype._onDrop;
    }
    const oldOnDrop = this.oldOnDrop;
    ActorSheet5eCharacter.prototype._onDrop = async function (event) {
      // TODO: implement category drag'n'drop
      return oldOnDrop.bind(this)(event);
    };
  }

  replaceOnDropItem() {
    if (this.oldOnDropItem === undefined) {
      this.oldOnDropItem = ActorSheet5eCharacter.prototype._onDropItem;
    }
    const oldOnDropItem = this.oldOnDropItem;
    ActorSheet5eCharacter.prototype._onDropItem = async function (event, data) {
      // dropping new item
      if (data.actorId !== this.object.id || data.data === undefined) {
        return oldOnDropItem.bind(this)(event, data);
      }

      // droping item outside inventory list
      const targetLi = $(event.target).parents("li")[0];
      if (targetLi === undefined || targetLi.className === undefined) {
        return oldOnDropItem.bind(this)(event, data);
      }

      // doing actual stuff!!!
      const id = data.data._id;
      const dropedItem = this.object.getOwnedItem(id);

      let targetType = "";
      const targetCss = InventoryPlus.getCSSName("sub-header");
      if (targetLi.className.trim().indexOf(targetCss) !== -1) {
        targetType = $(targetLi).find(".item-control")[0].dataset.type;
      } else if (targetLi.className.trim().indexOf("item") !== -1) {
        const itemId = targetLi.dataset.itemId;
        const item = this.object.getOwnedItem(itemId);
        targetType = this.inventoryPlus.getItemType(item.data);
      }

      // changing item list
      let itemType = this.inventoryPlus.getItemType(data.data);
      if (itemType !== targetType) {
        const categoryWeight =
          this.inventoryPlus.getCategoryItemWeight(targetType);
        const itemWeight = dropedItem.data.totalWeight;
        const maxWeight = Number(
          this.inventoryPlus.customCategorys[targetType].maxWeight
            ? this.inventoryPlus.customCategorys[targetType].maxWeight
            : 0
        );

        if (
          maxWeight == NaN ||
          maxWeight <= 0 ||
          maxWeight >= categoryWeight + itemWeight
        ) {
          await dropedItem.update({
            "flags.inventory-plus.category": targetType,
          });
          itemType = targetType;
        } else {
          ui.notifications.warn("Item exceedes categorys max weight");
          return;
        }
      }

      // reordering items

      // Get the drag source and its siblings
      const source = dropedItem;
      const siblings = this.object.items.filter((i) => {
        const type = this.inventoryPlus.getItemType(i.data);
        return type === itemType && i.data._id !== source.data._id;
      });
      // Get the drop target
      const dropTarget = event.target.closest(".item");
      const targetId = dropTarget ? dropTarget.dataset.itemId : null;
      const target = siblings.find((s) => s.data._id === targetId);

      // Perform the sort
      const sortUpdates = SortingHelpers.performIntegerSort(dropedItem, {
        target: target,
        siblings,
      });
      const updateData = sortUpdates.map((u) => {
        const update = u.update;
        update._id = u.target.data._id;
        return update;
      });

      // Perform the update
      this.object.updateEmbeddedEntity("OwnedItem", updateData);
    };
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
    const actorFlag = this.actor.getFlag("inventory-plus", "categorys");
    if (actorFlag === undefined) {
      this.customCategorys = {
        weapon: {
          label: "DND5E.ItemTypeWeaponPl",
          dataset: { type: "weapon" },
          sortFlag: 1000,
          ignoreWeight: false,
          maxWeight: 0,
          ownWeight: 0,
          collapsed: false,
        },
        equipment: {
          label: "DND5E.ItemTypeEquipmentPl",
          dataset: { type: "equipment" },
          sortFlag: 2000,
          ignoreWeight: false,
          maxWeight: 0,
          ownWeight: 0,
          collapsed: false,
        },
        consumable: {
          label: "DND5E.ItemTypeConsumablePl",
          dataset: { type: "consumable" },
          sortFlag: 3000,
          ignoreWeight: false,
          maxWeight: 0,
          ownWeight: 0,
          collapsed: false,
        },
        tool: {
          label: "DND5E.ItemTypeToolPl",
          dataset: { type: "tool" },
          sortFlag: 4000,
          ignoreWeight: false,
          maxWeight: 0,
          ownWeight: 0,
          collapsed: false,
        },
        backpack: {
          label: "DND5E.ItemTypeContainerPl",
          dataset: { type: "backpack" },
          sortFlag: 5000,
          ignoreWeight: false,
          maxWeight: 0,
          ownWeight: 0,
          collapsed: false,
        },
        loot: {
          label: "DND5E.ItemTypeLootPl",
          dataset: { type: "loot" },
          sortFlag: 6000,
          ignoreWeight: false,
          maxWeight: 0,
          ownWeight: 0,
          collapsed: false,
        },
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
    const addCategoryBtn = $(
      '<a class="custom-category"><i class="fas fa-plus"></i> Add Custom Category</a>'
    ).click(async (ev) => {
      const template = await renderTemplate(
        "modules/inventory-plus/templates/categoryDialog.hbs",
        {}
      );
      const d = new Dialog({
        title: "Creating new Inventory Category",
        content: template,
        buttons: {
          accept: {
            icon: '<i class="fas fa-check"></i>',
            label: "Accept",
            callback: async (html) => {
              const input = html.find("input");
              this.createCategory(input);
            },
          },
          cancle: {
            icon: '<i class="fas fa-times"></i>',
            label: "Cancel",
          },
        },
        default: "accept",
      });
      d.render(true);
    });
    html.find(".inventory .filter-list").prepend(addCategoryBtn);

    /*
     *  add removal function
     */

    const createBtns = html.find(".inventory .item-create");
    for (const createBtn of createBtns) {
      const type = createBtn.dataset.type;
      if (
        [
          "weapon",
          "equipment",
          "consumable",
          "tool",
          "backpack",
          "loot",
        ].indexOf(type) === -1
      ) {
        const parent = createBtn.parentNode;
        const removeCategoryBtn = $(
          `<a class="item-control remove-category" title="Delete Category" data-type="${type}"><i class="fas fa-minus"></i> Del.</a>`
        );
        removeCategoryBtn.click((ev) => this.removeCategory(ev));
        parent.innerHTML = "";
        $(parent).append(removeCategoryBtn);
      }
    }

    /*
     *  add extra header functions
     */

    const targetCss = `.inventory .${InventoryPlus.getCSSName("sub-header")}`;
    const headers = html.find(targetCss);
    for (let header of headers) {
      header = $(header);
      const type = header.find(".item-control")[0].dataset.type;

      const extraStuff = $('<div class="inv-plus-stuff flexrow"></div>');
      header.find("h3").after(extraStuff);

      if (this.customCategorys[type] === undefined) {
        return;
      }

      // toggle item visibility
      const arrow =
        this.customCategorys[type].collapsed === true ? "right" : "down";
      const toggleBtn = $(
        `<a class="toggle-collapse"><i class="fas fa-caret-${arrow}"></i></a>`
      ).click((ev) => {
        this.customCategorys[type].collapsed =
          !this.customCategorys[type].collapsed;
        this.saveCategorys();
      });
      header.find("h3").before(toggleBtn);

      // reorder category
      if (this.getLowestSortFlag() !== this.customCategorys[type].sortFlag) {
        const upBtn = $(
          `<a class="inv-plus-stuff shuffle-up" title="Move category up"><i class="fas fa-chevron-up"></i></a>`
        ).click(() => this.changeCategoryOrder(type, true));
        extraStuff.append(upBtn);
      }
      if (this.getHighestSortFlag() !== this.customCategorys[type].sortFlag) {
        const downBtn = $(
          `<a class="inv-plus-stuff shuffle-down" title="Move category down"><i class="fas fa-chevron-down"></i></a>`
        ).click(() => this.changeCategoryOrder(type, false));
        extraStuff.append(downBtn);
      }

      // edit category
      const editCategoryBtn = $(
        '<a class="inv-plus-stuff customize-category"><i class="fas fa-edit"></i></a>'
      ).click(async (ev) => {
        const template = await renderTemplate(
          "modules/inventory-plus/templates/categoryDialog.hbs",
          this.customCategorys[type]
        );
        const d = new Dialog({
          title: "Edit Inventory Category",
          content: template,
          buttons: {
            accept: {
              icon: '<i class="fas fa-check"></i>',
              label: "Accept",
              callback: async (html) => {
                const inputs = html.find("input");
                for (const input of inputs) {
                  let value =
                    input.type === "checkbox" ? input.checked : input.value;
                  if (input.dataset.dtype === "Number") {
                    value = Number(value) > 0 ? Number(value) : 0;
                  }
                  this.customCategorys[type][input.name] = value;
                }
                this.saveCategorys();
              },
            },
            cancle: {
              icon: '<i class="fas fa-times"></i>',
              label: "Cancel",
            },
          },
          default: "accept",
        });
        d.render(true);
      });
      extraStuff.append(editCategoryBtn);

      // hide collapsed category items
      if (this.customCategorys[type].collapsed === true) {
        header.next().hide();
      }

      if (this.customCategorys[type].maxWeight > 0) {
        const weight = this.getCategoryItemWeight(type);
        const weightString = $(
          `<label class="category-weight">( ${weight}/${
            this.customCategorys[type].maxWeight
          }  ${game.i18n.localize("DND5E.AbbreviationLbs")})</label>`
        );
        header.find("h3").append(weightString);
      }
    }
  }

  prepareInventory(inventory) {
    const sections = duplicate(this.customCategorys);

    for (const id in sections) {
      sections[id].items = [];
    }

    for (const section of inventory) {
      for (const item of section.items) {
        let type = this.getItemType(item);
        if (sections[type] === undefined) {
          type = item.type;
        }
        sections[type].items.push(item);
      }
    }

    // sort items within sections
    for (const id in sections) {
      const section = sections[id];
      section.items.sort((a, b) => {
        return a.sort - b.sort;
      });
    }
    return sections;
  }

  createCategory(inputs) {
    const newCategory = {};

    for (const input of inputs) {
      let value = input.type === "checkbox" ? input.checked : input.value;
      if (input.dataset.dtype === "Number") {
        value = Number(value) > 0 ? Number(value) : 0;
      }
      newCategory[input.name] = value;
    }

    if (newCategory.label === undefined || newCategory.label === "") {
      ui.notifications.error(
        "Could not create Category as no name was specified"
      );
      return;
    }

    const key = this.generateCategoryId();

    newCategory.dataset = { type: key };
    newCategory.collapsed = false;
    newCategory.sortFlag = this.getHighestSortFlag() + 1000;
    this.customCategorys[key] = newCategory;
    this.saveCategorys();
  }

  async removeCategory(ev) {
    const catType = ev.target.dataset.type;
    const changedItems = [];
    for (const item of this.actor.items) {
      const type = this.getItemType(item.data);
      if (type === catType) {
        //await item.unsetFlag('inventory-plus', 'category');
        changedItems.push({
          _id: item.id,
          "-=flags.inventory-plus": null,
        });
      }
    }
    await this.actor.updateEmbeddedEntity("OwnedItem", changedItems);

    delete this.customCategorys[catType];
    const deleteKey = `-=${catType}`;
    this.actor.setFlag("inventory-plus", "categorys", { [deleteKey]: null });
  }

  changeCategoryOrder(movedType, up) {
    let targetType = movedType;
    let currentSortFlag = 0;
    if (!up) currentSortFlag = 999999999;
    for (const id in this.customCategorys) {
      const currentCategory = this.customCategorys[id];
      if (up) {
        if (
          id !== movedType &&
          currentCategory.sortFlag < this.customCategorys[movedType].sortFlag &&
          currentCategory.sortFlag > currentSortFlag
        ) {
          targetType = id;
          currentSortFlag = currentCategory.sortFlag;
        }
      } else {
        if (
          id !== movedType &&
          currentCategory.sortFlag > this.customCategorys[movedType].sortFlag &&
          currentCategory.sortFlag < currentSortFlag
        ) {
          targetType = id;
          currentSortFlag = currentCategory.sortFlag;
        }
      }
    }

    if (movedType !== targetType) {
      const oldMovedSortFlag = this.customCategorys[movedType].sortFlag;
      const newMovedSortFlag = currentSortFlag;

      this.customCategorys[movedType].sortFlag = newMovedSortFlag;
      this.customCategorys[targetType].sortFlag = oldMovedSortFlag;
      this.applySortKey();
      this.saveCategorys();
    }
  }

  applySortKey() {
    const sortedCategorys = {};

    const keys = Object.keys(this.customCategorys);
    keys.sort((a, b) => {
      return (
        this.customCategorys[a].sortFlag - this.customCategorys[b].sortFlag
      );
    });
    for (const key of keys) {
      sortedCategorys[key] = this.customCategorys[key];
    }
    this.customCategorys = sortedCategorys;
  }

  getHighestSortFlag() {
    let highest = 0;

    for (const id in this.customCategorys) {
      const cat = this.customCategorys[id];
      if (cat.sortFlag > highest) {
        highest = cat.sortFlag;
      }
    }

    return highest;
  }

  getLowestSortFlag() {
    let lowest = 999999999;

    for (const id in this.customCategorys) {
      const cat = this.customCategorys[id];
      if (cat.sortFlag < lowest) {
        lowest = cat.sortFlag;
      }
    }

    return lowest;
  }

  generateCategoryId() {
    let id = "";
    let iterations = 100;
    do {
      id = Math.random().toString(36).substring(7);
      iterations--;
    } while (
      this.customCategorys[id] !== undefined &&
      iterations > 0 &&
      id.length >= 5
    );

    return id;
  }

  getItemType(item) {
    let type = getProperty(item, "flags.inventory-plus.category");
    if (type === undefined || this.customCategorys[type] === undefined) {
      type = item.type;
    }
    return type;
  }

  getCategoryItemWeight(type) {
    let weight = 0;
    for (const i of this.actor.items) {
      if (type === this.getItemType(i.data)) {
        weight += i.data.totalWeight;
      }
    }
    return weight;
  }

  static calculateWeight(inventory, currency) {
    let customWeight = 0;
    for (const id in inventory) {
      const section = inventory[id];
      if (section.ignoreWeight !== true) {
        for (const i of section.items) {
          customWeight += i.totalWeight;
        }
      }
      if (Number(section.ownWeight) > 0) {
        customWeight += Number(section.ownWeight);
      }
    }

    let coinWeight = 0;
    if (game.settings.get("dnd5e", "currencyWeight")) {
      const numCoins = Object.values(currency).reduce(
        (val, denom) => (val += Math.max(denom, 0)),
        0
      );
      coinWeight =
        Math.round(
          (numCoins * 10) / CONFIG.DND5E.encumbrance.currencyPerWeight
        ) / 10;
    }
    customWeight += coinWeight;

    customWeight = Number(customWeight).toFixed(2);

    return customWeight;
  }

  static getCSSName(element) {
    const version = game.system.data.version.split(".");
    if (element === "sub-header") {
      if (version[0] == 0 && version[1] <= 9 && version[2] <= 8) {
        return "inventory-header";
      } else {
        return "items-header";
      }
    }
  }

  async saveCategorys() {
    //this.actor.update({ 'flags.inventory-plus.categorys': this.customCategorys }).then(() => { console.log(this.actor.data.flags) });
    await this.actor.setFlag(
      "inventory-plus",
      "categorys",
      this.customCategorys
    );
  }
}

Hooks.on("ready", () => {
  InventoryPlus.replaceGetData();
});

Hooks.on(`renderActorSheet5eCharacter`, (app, html, data) => {
  app.inventoryPlus.addInventoryFunctions(html);
});
