/*
  A small class for scheduling tasks to be performed in the future. Note that tasks will not be performed exactly when desired, as tasks are checked according to the pollInterval set in this class.
*/

class Schedule {
  constructor(options = {}) {
    // Merge the provided options with a set of defaults, in case some are not set.
    this.options = {
      ...options, ...{
        pollInterval: 100
      }
    };

    // Start the main timer.
    this.timer = setInterval(this.runScheduledItems.bind(this), this.options.pollInterval)

    this._scheduledItems = [];
  }

  // Returns items that are scheduled to be run. Also removes them from the scheduled items
  // array, if this argument is set to true.
  getScheduledItems(removeReturnedFromScheduledItems = false) {
    const currentTime = Date.now();
    return this.allScheduledItems.filter((scheduledItem, i) => {
      const willReturnItem = scheduledItem.runTime < currentTime;
      if (willReturnItem && removeReturnedFromScheduledItems) {
        this.allScheduledItems.splice(i, 1);
      }
      return willReturnItem;
    });
  }

  runScheduledItems() {
    // Check if the runTime provided with each item in scheduledItems has passed (or is going to pass soon).
    // If it is, run it.
    let scheduledItems = this.getScheduledItems(true);
    scheduledItems.forEach((scheduledItem, i) => {
      scheduledItem.run();
    });
  }

  addItem(item) {
    if (item.run && item.runTime) {
      this.allScheduledItems.push(item);
    } else {
      throw { type: "error", message: "A scheduled item must have two properties - run (a function to run) and time (a unix timestamp of when to run the function)." };
    }
  }

  get allScheduledItems() {
    return this._scheduledItems;
  }

}

module.exports = Schedule;