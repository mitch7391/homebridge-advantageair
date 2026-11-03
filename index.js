"use strict";
const chalk = require("chalk");

// The optional platform constructor is not called by Cmd4-only configurations.
const announcementKey = Symbol.for("homebridge-cmd4-advantageair.v4-announcement");

module.exports =
{
   default: function ( api )
   {
     api.registerPlatform( "cmd4AdvantageAir", Cmd4AdvantageAir );
     if ( !process[ announcementKey ] && typeof api.once === "function" && typeof api.removeListener === "function" )
     {
       process[ announcementKey ] = true;
       let timer;
       let stopped = false;
       const shutdown = () => {
         stopped = true;
         clearTimeout(timer);
         timer = undefined;
         api.removeListener("didFinishLaunching", launched);
         api.removeListener("shutdown", shutdown);
       };
       const launched = () => {
         if ( stopped ) return;
         timer = setTimeout(() => {
           timer = undefined;
           if ( stopped ) return;
           stopped = true;
           api.removeListener("shutdown", shutdown);
           // Homebridge supplies no public logger to the plugin initialiser.
           console.info(chalk.blueBright("[AdvantageAir] Native Advantage Air v4 is available as a separate Homebridge plugin!"));
           console.info(chalk.blueBright("[AdvantageAir] Package: homebridge-advantageair"));
           console.info(chalk.blueBright("[AdvantageAir] Your existing v3 setup is unaffected; migration is optional and manual."));
           console.info(chalk.blueBright("[AdvantageAir] Compatibility and migration guide: " +
             "https://github.com/mitch7391/homebridge-advantageair/blob/master/docs/v3-migration.md"));
         }, 30000);
         timer.unref();
       };
       api.once("didFinishLaunching", launched);
       api.once("shutdown", shutdown);
     }
   }
}

// Platform definition
class Cmd4AdvantageAir
{
   constructor( log, config, api )
   {
      this.log = log;
      this.api = api;
      this.config = config;
      this.log.debug("cmd4AdvantageAir this.config %s", this.config);
   }
}
