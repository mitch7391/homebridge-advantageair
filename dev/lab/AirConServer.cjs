var fs = require('fs');
const http = require('http');
var url = require('url');

// Command line parser
const { Command } = require( "../../node_modules/commander" );
const program = new Command;

// Parse the args
var args = process.argv.slice(2);
var system = args[0] || "smallSystem";

// Setting up PORT and TMPDIR
var port_g = process.env.PORT || 2025;
var TMPDIR = process.env.TMPDIR || "/tmp"

var debug_g = true;
var exists_fan = true;
var exists_state = true;
var keyMatch = true; 

var pfan = /fan/;
var pstate = /state/;
var quotedValues;
var curlRunTime=0;
var setKey="setAircon";
var keyNotFound;  

var changingRecord = false;

// A nice little getOpt node.js package
program
  .description( 'Start the AirCon server, if not already running' )

  .option( '-p, --port', `Port to use. .\nDefault: ${ port_g } .` )
  .option( '-d, --debug', `Set debug output to $file. .\nDefault: ${  debug_g } .` );


// Parse the arguments passed into this program.
program.parse( process.argv );


// Get the options passed in based on the commander getOpts definitions.
let options = program.opts( );

if ( options.debug )
   debug_g = options.debug;
if ( options.port )
   port_g = options.port;

var server_g = null;
var listener_g = null;
var stack_g=[];

var sockets = {}, nextSocketId = 0;

const log = function( str )
{
   if ( debug_g == true )
      console.log( str );
}

function sleep(milliseconds) {
  const date = Date.now();
  let currentDate = null;
  do {
    currentDate = Date.now();
  } while (currentDate - date < milliseconds);
}

function simulateCurlRunTime() {
   // This function is to simulate the time taken for "curl" command to complete
   // for a big MyPlace system with lots of scenes programmed.
   // This time taken simulator is based on the histogram generated from 6,107 actual
   // measurements of time taken for curl to complete on a real MyPlace system.
   // The time taken can range from 1 second to 60 seconds and occassionally beyond 60 seconds.
   // On average, the time taken for curl to complete is ~6 seconds.

   var value = Math.floor(Math.random() * 6108);
   if (value >=  0 && value <= 58 ) { curlRunTime=1 }
   if (value >=  59 && value <= 274 ) { curlRunTime=2 }
   if (value >=  275 && value <= 1389 ) { curlRunTime=3 }
   if (value >=  1390 && value <= 2891 ) { curlRunTime=4 }
   if (value >=  2892 && value <= 3916 ) { curlRunTime=5 }
   if (value >=  3917 && value <= 4589 ) { curlRunTime=6 }
   if (value >=  4590 && value <= 5045 ) { curlRunTime=7 }
   if (value >=  5046 && value <= 5295 ) { curlRunTime=8 }
   if (value >=  5296 && value <= 5475 ) { curlRunTime=9 }
   if (value >=  5476 && value <= 5591 ) { curlRunTime=10 }
   if (value >=  5592 && value <= 5725 ) { curlRunTime=11 }
   if (value >=  5726 && value <= 5775 ) { curlRunTime=12 }
   if (value >=  5776 && value <= 5823 ) { curlRunTime=13 }
   if (value >=  5824 && value <= 5855 ) { curlRunTime=14 }
   if (value >=  5856 && value <= 5876 ) { curlRunTime=15 }
   if (value >=  5877 && value <= 5900 ) { curlRunTime=16 }
   if (value >=  5901 && value <= 5923 ) { curlRunTime=17 }
   if (value >=  5924 && value <= 5948 ) { curlRunTime=18 }
   if (value >=  5949 && value <= 5968 ) { curlRunTime=19 }
   if (value >=  5969 && value <= 5979 ) { curlRunTime=20 }
   if (value >=  5980 && value <= 5988 ) { curlRunTime=21 }
   if (value >=  5989 && value <= 6001 ) { curlRunTime=22 }
   if (value >=  6002 && value <= 6008 ) { curlRunTime=23 }
   if (value >=  6009 && value <= 6018 ) { curlRunTime=24 }
   if (value >=  6019 && value <= 6022 ) { curlRunTime=25 }
   if (value >=  6023 && value <= 6028 ) { curlRunTime=26 }
   if (value >=  6029 && value <= 6035 ) { curlRunTime=27 }
   if (value >=  6036 && value <= 6040 ) { curlRunTime=28 }
   if (value >=  6041 && value <= 6042 ) { curlRunTime=29 }
   if (value >=  6043 && value <= 6044 ) { curlRunTime=30 }
   if (value >=  6045 && value <= 6046 ) { curlRunTime=31 }
   if (value >=  6047 && value <= 6048 ) { curlRunTime=32 }
   if (value >=  6049 && value <= 6050 ) { curlRunTime=33 }
   if (value >=  6051 && value <= 6052 ) { curlRunTime=34 }
   if (value >=  6053 && value <= 6054 ) { curlRunTime=35 }
   if (value >=  6055 && value <= 6056 ) { curlRunTime=36 }
   if (value >=  6057 && value <= 6058 ) { curlRunTime=37 }
   if (value >=  6059 && value <= 6060 ) { curlRunTime=38 }
   if (value >=  6061 && value <= 6062 ) { curlRunTime=39 }
   if (value >=  6063 && value <= 6064 ) { curlRunTime=40 }
   if (value >=  6065 && value <= 6066 ) { curlRunTime=41 }
   if (value >=  6067 && value <= 6068 ) { curlRunTime=42 }
   if (value >=  6069 && value <= 6070 ) { curlRunTime=43 }
   if (value >=  6071 && value <= 6072 ) { curlRunTime=44 }
   if (value >=  6073 && value <= 6074 ) { curlRunTime=45 }
   if (value >=  6075 && value <= 6076 ) { curlRunTime=46 }
   if (value >=  6077 && value <= 6078 ) { curlRunTime=47 }
   if (value >=  6079 && value <= 6080 ) { curlRunTime=48 }
   if (value >=  6081 && value <= 6082 ) { curlRunTime=49 }
   if (value >=  6083 && value <= 6084 ) { curlRunTime=50 }
   if (value >=  6085 && value <= 6086 ) { curlRunTime=51 }
   if (value >=  6087 && value <= 6088 ) { curlRunTime=52 }
   if (value >=  6089 && value <= 6090 ) { curlRunTime=53 }
   if (value >=  6091 && value <= 6092 ) { curlRunTime=54 }
   if (value >=  6093 && value <= 6094 ) { curlRunTime=55 }
   if (value >=  6095 && value <= 6096 ) { curlRunTime=56 }
   if (value >=  6097 && value <= 6098 ) { curlRunTime=57 }
   if (value >=  6099 && value <= 6100 ) { curlRunTime=58 }
   if (value >=  6101 && value <= 6102 ) { curlRunTime=59 }
   if (value >=  6103 && value <= 6104 ) { curlRunTime=60 }
   if (value >=  6105 && value <= 6105 ) { curlRunTime=61 }
   if (value >=  6106 && value <= 6106 ) { curlRunTime=62 }
   if (value >=  6107 && value <= 6107 ) { curlRunTime=63 }
   return curlRunTime
}

function traverseAssign( obj1, obj2 )
{
   //console.log("checking obj1 %s", obj1 );
   for ( let key in obj1 )
   {
      //console.log("checking obj2[%s]=%s", key, obj2[key]," (if undefined, abort!)");
      if ( key == "aircons" ) { keyNotFound = ""; }
      keyNotFound = keyNotFound + "." + key;
      if ( obj2[key] == undefined )
      {
         keyMatch = false;
         break;
      }

      //console.log("checking obj1[%s] type %s", key, typeof obj1[key] );
      if ( typeof obj1[key] == "object" )
      {
         //console.log("obj1[%s] == Object", key );
         // An Array is an object
         if ( Array.isArray( obj1[ key ]  ) == false )
         {
            //console.log("obj1[%s] != Array", key );
            if ( ! obj2[ key ] )
            {
               //console.log("Adding Object obj1[%s] to obj2", key);
               obj2[ key ] = obj1[ key ]
            } else {
              //console.log("traversing obj1[%s]", key);
               traverseAssign( obj1[key], obj2[key] )
            }
         } else
         {
            // Do not gandle arrays at this time
         }
      } else {
         //console.log("Adding key obj1[%s]=%s to obj2", key, obj1[key]);
         obj2[key] = obj1[key];
      }
   }
}

const requestListener = function (req, res)
{
   req.on('close', function ()
   {
      //log( `req.on: close listener: ` );
      // Try to remove connected listener
      //nothing server_g.removeListener( "requestListener", requestListener, this);
      //nothing server_g.removeListener( "connection", requestListener );
      // The "listener" argument must be of type function. Received type string ('requestListener')
      // server_g.removeListener( "connection", "requestListener" );
      // The "listener" argument must be of type function. Received an instance of IncomingMessage
      // server_g.removeListener( "connection", this );
      // nothingserver_g.removeListener( "connection", requestListener, this );
      //server_g.removeListener( "connection", requestListener );
      // console.log( "server_g._events: %s\n\n", server_g._events);
      // server._events: [Object: null prototype] {
      //    request: [Function: requestListener],
      //    connection: [Array],
      //    close: [Array],
      //    error: [Function]
      //  }
      //for ( let x=0; x< server_g._events.connection.length; x++)
      //{
      //    console.log( "server_g._events.connection[%s: %s\n\n", x, server_g._events.connection[x]);
      //}
      // Caused hang for second curl
      // server_g.removeListener( "request", requestListener );

   });

   /* Request methods. Not needed, but interesting
   switch( req.method )
   {
      case 'POST':
         log("SERVER: POST");
         break;
      case 'GET':
         log("SERVER: POST");
         break;
      default:
         log("SERVER: UNKNOWN method: %s", req.method);
   }
   */


   // Example URL parsing
   // var adr = 'http://localhost:$PORT/default.htm?year=2017&month=february';
   var q = url.parse(req.url, true);
   let ended = true;

   //log(q.host); //returns 'localhost:8080'
   //log(q.pathname); //returns '/default.htm'
   //log(q.search); //returns '?year=2017&month=february'
   //var qdata = q.query; //returns an object: { year: 2017, month: 'february' }
   //log(qdata.month); //returns 'february'

   // Format of stack is:
   //    "filename":      The file to load getSystemData with
   //    "getSystemData": The myAirData json data read from filename,
   //    "repeat":        The number of times remaining for this data to be used.
   //    "myAirData":     The systemData in json format.
   //
   //
   // The last record is used continiously.
   //
   // Examples
   //    curl -s -g 'http://localhost:$PORT?load=testData/dataPassOn1/getSystemData.txt0'
   //    curl -s -g 'http://localhost:$PORT?repeat=5?load=testData/dataPassOn1/getSystemData.txt0'
   //    curl -s -g 'http://localhost:$PORT/getDystemData'
   //    curl -s -g 'http://localhost:$PORT/shutdown'
   //    curl -s -g 'http://localhost:$PORT/quit'
   //    curl -s -g 'http://localhost:$PORT/reInit'
   //    curl -s -g 'http://localhost:$PORT?debug=1'
   //    curl -s -g 'http://localhost:$PORT?dumpStack'
   //
   //      Note: "repeat" must come first, otherwise 0 is used.
   //
   // Default to repeating the last record in the stack
   let repeat = 0;
   let filename;
   let setInProgress=false;
   let setThingInProgress=false;
   let setLightInProgress=false;


   log( `SERVER: parsing pathname:${ q.pathname }` );
   switch( q.pathname )
   {
      case "/":
      {
         log( `Ignoring pathname /` );
         log( `SERVER: end` );
         ended = false;
         break;
      }
      case "/reInit":
      {
         log( `SERVER: Doing reInit` );
         repeat = 0;
         if ( filename ) filename = null;
         stack_g = [];
         log( `SERVER: end` );
         return res.end();
      }
      case "/dumpStack":
      {
         log( `SERVER: Doing dumpStack` );
         res.writeHead(200, { 'Content-Type': 'text/html' } );
         log( `stack.length=${ stack_g.length }` );
         for ( let index=0; index < stack_g.length; index++ )
         {
            let record = stack_g[ index ];
            res.write( `repeat: ${ record.repeat } filename: ${record.filename }\n` );
         }
         log( `SERVER: end` );
         return res.end();
      }
      case "/setAircon":
      {
         log( `SERVER: Doing setAircon` );
         setKey="setAircon";
         setInProgress=true;
         ended = false;
         break;
      }
      case "/setLight":
      {
         log( `SERVER: Doing setLight` );
         setKey="setLight";
         setLightInProgress=true;
         ended = false;
         break;
      }
      case "/setThing":
      {
         log( `SERVER: Doing setThing` );
         setKey="setThing";
         setThingInProgress=true;
         ended = false;
         break;
      }
      case "/getSystemData":
      {
         if ( stack_g.length == 0 )
         {
            log( `No File Loaded` );
            res.writeHead(404, { 'Content-Type': 'text/html' } );
            log( `SERVER: end` );
            return res.end( `404 No File Loaded` );
         }
         let record = stack_g.shift();

         if ( stack_g.length == 0 )
         {
            // Don't care if less than zero
            record.repeat --;
            stack_g.unshift( record );
         } else
         {
            if ( --record.repeat > 0 )
               stack_g.unshift( record );
         }

         // update the "countDownToOn", "countDownToOff" and "state" of aircon first
         for(let count = 1; count < 5; count++) {
            let ac = "ac" + count
            if ( record.myAirData.aircons[ac] != undefined ) {
               let countDownToOnValue = record.myAirData.aircons[ac].info.countDownToOn;
               let countDownToOffValue = record.myAirData.aircons[ac].info.countDownToOff;
               let countDownFromValue = record.myAirData.aircons[ac].info.unitType;
               if ( countDownToOnValue != 0 ) {
                  if ( changingRecord == false ) {
                     log(`SERVER: Changing record:`);
                  }
                  countDownToOnValue = countDownToOnValue - Math.floor((Date.now() - countDownFromValue) / 60000);
                  countDownToOnValue = Math.max(countDownToOnValue, 0);
                  let value="{aircons:{" + ac + ":{info:{countDownToOn:" + countDownToOnValue + "}}}}";
                  quotedValues=value.replace(/(\{|,)\s*(.+?)\s*:/g, '$1"$2":');
                  let setStatementObj = JSON.parse( quotedValues );
                  console.log(`SERVER: setStatementObj.aircons.${ac}.info =`,setStatementObj.aircons[ac].info);
                  traverseAssign( setStatementObj, record.myAirData);
                  if ( countDownToOnValue == 0 ) {
                     // set the aircon state to "on"
                     value="{aircons:{" + ac + ":{info:{state:on}}}}"
                     quotedValues=value.replace(/([a-zA-Z0-9-.]+):([a-zA-Z0-9-]+)/g, "$1:\"$2\"")
                                       .replace(/(\{|,)\s*(.+?)\s*:/g, '$1"$2":');
                     setStatementObj = JSON.parse( quotedValues );
                     console.log(`SERVER: setStatementObj.aircons.${ac}.info =`,setStatementObj.aircons[ac].info);
                     traverseAssign( setStatementObj, record.myAirData);
                  }
                  value="{aircons:{" + ac + ":{info:{unitType:" + Date.now() + "}}}}";
                  quotedValues=value.replace(/(\{|,)\s*(.+?)\s*:/g, '$1"$2":');
                  setStatementObj = JSON.parse( quotedValues );
                  traverseAssign( setStatementObj, record.myAirData);
                  changingRecord = true
               }
               if ( countDownToOffValue != 0 ) {
                  if ( changingRecord == false ) {
                     log(`SERVER: Changing record:`);
                  }
                  countDownToOffValue = countDownToOffValue - Math.floor((Date.now() - countDownFromValue) / 60000);
                  countDownToOffValue = Math.max(countDownToOffValue, 0);
                  let value="{aircons:{" + ac + ":{info:{countDownToOff:" + countDownToOffValue + "}}}}";
                  quotedValues=value.replace(/(\{|,)\s*(.+?)\s*:/g, '$1"$2":');
                  let setStatementObj = JSON.parse( quotedValues );
                  console.log(`SERVER: setStatementObj.aircons.${ac}.info =`,setStatementObj.aircons[ac].info);
                  traverseAssign( setStatementObj, record.myAirData);
                  if ( countDownToOffValue == 0 ) {
                     // set the aircon state to "off"
                     value="{aircons:{" + ac + ":{info:{state:off}}}}";
                     quotedValues=value.replace(/([a-zA-Z0-9-.]+):([a-zA-Z0-9-]+)/g, "$1:\"$2\"")
                                       .replace(/(\{|,)\s*(.+?)\s*:/g, '$1"$2":');
                     setStatementObj = JSON.parse( quotedValues );
                     console.log(`SERVER: setStatementObj.aircons.${ac}.info =`,setStatementObj.aircons[ac].info);
                     traverseAssign( setStatementObj, record.myAirData);
                  }
                  value="{aircons:{" + ac + ":{info:{unitType:" + Date.now() + "}}}}";
                  quotedValues=value.replace(/(\{|,)\s*(.+?)\s*:/g, '$1"$2":');
                  setStatementObj = JSON.parse( quotedValues );
                  traverseAssign( setStatementObj, record.myAirData);
                  changingRecord = true
               }
            }
         }
         if ( changingRecord ) {
            log( `SERVER: creating new getSystemData` );
            record.getSystemData = JSON.stringify( record.myAirData );
            changingRecord = false;
         }

         //

         let systemDataToSend = record.getSystemData;

         res.writeHead(200, { 'Content-Type': 'text/json' } );
         res.write( systemDataToSend, 'utf8', () =>
         {
            log( `SERVER: Writing getSystemData, length: ${ systemDataToSend.length }` );
            log( `SERVER: end` );
         });

         // for big system, the curlRunTime takes longer
         if (system=="bigSystem")
         {
            simulateCurlRunTime(curlRunTime);
            sleep(curlRunTime*1000);
            console.log(`SERVER: getSystemData curl RunTime: ${curlRunTime} seconds`);
         }

         return res.end();


      }
      case "/quit":
      case "/shutdown":
      {
         // Interesting, while server_g and listener_g seem to be the same,
         // they are not. Listening_g properly closes the server and any
         // connections
         if (server_g.listening)
         {
            server_g.close();

            log("SERVER_G SEND BYE-BYE MESSAGE AND 'FIN' TO SOCKETS");
         }
         if (listener_g.listening)
         {
            listener_g.close();

            log("LISTENET_G SEND BYE-BYE MESSAGE AND 'FIN' TO SOCKETS");
         }


         log("GRACEFUL SHUTDOWN");
         res.writeHead(200, { 'Content-Type': 'text/html' } );
         log( `SERVER: end` );
         return res.end();
      }
      default:
      {
         res.writeHead(404, { 'Content-Type': 'text/html' } );
         log( `SERVER: UNKNOWN pathname: ${ q.pathname }` );
         log( `SERVER: end` );
         return res.end( `SERVER: UNKNOWN pathname: ${ q.pathname }` );
      }
   }

   for ( let key in q.query )
   {
      let value = q.query[ key ];
      log( `SERVER: parsing key: ${ key } value: ${ value }` );
      switch( key )
      {
         case "debug": // ?debug=1
         {
            debug_g = value;
            log( `Setting debug_g to ${ debug_g}` );
            log( `SERVER: end` );
            return res.end();
         }
         case "repeat": // ?repeat=x
         {
            repeat = value;
            log( `Setting repeat to ${ repeat }` );
            log( `SERVER: end` );
            // Do not return, possible furthet options
            ended = false;
            break;
         }
         case "save": // ?save
         {
            if ( stack_g.length == 0 )
            {
               res.writeHead( 404, { 'Content-Type': 'text/html' } );
               log( `SERVER: No data loaded to save` );
               log( `SERVER: end` );
               return res.end();
            }
            let record = stack_g[0];
            fs.writeFileSync( `${TMPDIR}/AA-001/AirConServerData.json`, record.getSystemData);

            log( `SERVER: end` );
            return res.end();
         }
         case "load": // ?load=testData/getSystemData.txt
         {
            log( `In load` );
            filename = value;
            // Check that the file exists locally
            // log( `SERVER: checking for file: ${ filename }` );
            if ( !fs.existsSync( filename ) )
            {
               log( `File not found: ${ filename }` );
               res.writeHead( 404, { 'Content-Type': 'text/html' } );
               log( `SERVER: end` );
               return res.end( `404 Not Found` );
            }

            log( `SERVER: reading: ${ filename }` );
            let getSystemData = fs.readFileSync( filename, 'utf-8')
            log( `SERVER: read length: ${ getSystemData.length }` );
            log( `SERVER: end` );
            let myAirData=JSON.parse( getSystemData );
            res.writeHead( 200, { 'Content-Type': 'text/html' } );
            stack_g.push( { "filename": filename,
                            "getSystemData": getSystemData,
                            "repeat": repeat,
                            "myAirData": myAirData } );

            log( `SERVER: end` );
            return res.end();
         }
         case "json": // ?json
         {
            // There must be systemData loaded
            if ( stack_g.length == 0 )
            {
               res.writeHead( 404, { 'Content-Type': 'text/html' } );
               log( `SERVER: No data loaded to set for ${ value }` );
               log( `SERVER: end` );
               return res.end();
            }
            let record = stack_g[0];

            if ( setInProgress == true )
            {
               // Get The ac number specified in the "Set" statement
               // ".aircons.$ac.info.setTemp"
               // Isolated v4 trial: JSON payloads replace the old Cmd4 unquoted parser.
               let setStatementObj = { aircons: JSON.parse(value) };
               const keys = Object.keys(setStatementObj.aircons);
               if (keys.length !== 1 || !/^ac[0-9]+$/.test(keys[0])) throw Error('Invalid simulator aircon');
               const ac = keys[0];
               if ( setStatementObj.result == false )
               {
                  res.writeHead( 404, { 'Content-Type': 'text/html' } );
                  log( `SERVER: Cannot Parse ${ value }` );
                  log( `SERVER: end` );
                  return res.end();
               }

               log( `SERVER: Changing record:` );

               // AT THIS POINT WE CAN DO WHAT THE AIRCON WOULD HAVE DONE
               // GIVEN THE "Set" Statement
               // Get the Keys of what is being "Set"
               if ( setStatementObj.aircons[ac].zones )
               {
                  console.log(`SERVER: setStatementObj.${ac}.zones =`, setStatementObj.aircons[ac].zones);
                  for ( let zone in setStatementObj.aircons[ac].zones )
                  {
                     for ( let key in setStatementObj.aircons[ac].zones[zone] )
                     {
                        switch( key )
                        {
                           case "state":
                           {
                              // Add/change myAirData just those elements in the set statement
                              traverseAssign( setStatementObj, record.myAirData);
                              break;
                           }
                           case "value":
                           {
                              // Add/change myAirData just those elements in the set statement
                              traverseAssign( setStatementObj, record.myAirData);
                              break;
                           }
                           case "setTemp":
                           {
                              // Add/change myAirData just those elements in the set statement
                              traverseAssign( setStatementObj, record.myAirData);
                              break;
                           }
                           default:
                           {
                              console.log( `unhandled setAircon zone key: ${zone} key:  ${key}` );
                              keyMatch = false;
                              break;
                              // process.exit( 1 );
                           }
                        }
                        if ( keyMatch == false ) 
                        {
                           log(`unhandled setAircon zone key: ${ac} zones ${zone} ${key}`)
                        }
                     }
                  }
               }
               if ( setStatementObj.aircons[ac].info )
               {
                  console.log(`SERVER: setStatementObj.aircons.${ac}.info =`,setStatementObj.aircons[ac].info)
                  for ( let key in setStatementObj.aircons[ac].info )
                  {
                     switch( key )
                     {
                        case "state":
                        {
                           // Add/change myAirData just those elements in the set statement
                           let currentState = setStatementObj.aircons[ac].info.state;
                           traverseAssign( setStatementObj, record.myAirData);
                           if ( currentState == "on" ) {
                              value="{aircons:{" + ac + ":{info:{countDownToOn:0}}}}";
                              quotedValues=value.replace(/(\{|,)\s*(.+?)\s*:/g, '$1"$2":');
                              setStatementObj = JSON.parse( quotedValues );
                              console.log(`SERVER: setStatementObj.aircons.${ac}.info =`,setStatementObj.aircons[ac].info)
                              traverseAssign( setStatementObj, record.myAirData);
                           } else {
                              value="{aircons:{" + ac + ":{info:{countDownToOff:0}}}}";
                              quotedValues=value.replace(/(\{|,)\s*(.+?)\s*:/g, '$1"$2":');
                              setStatementObj = JSON.parse( quotedValues );
                              console.log(`SERVER: setStatementObj.aircons.${ac}.info =`,setStatementObj.aircons[ac].info)
                              traverseAssign( setStatementObj, record.myAirData);
                           }
                           break;
                        }
                        case "setTemp":
                        {
                           // Add/change myAirData just those elements in the set statement
                           traverseAssign( setStatementObj, record.myAirData);
                           break;
                        }
                        case "mode":
                        {
                           // Add/change myAirData just those elements in the set statement
                           traverseAssign( setStatementObj, record.myAirData);
                           break;
                        }
                        case "fan":
                        {
                           // Add/change myAirData just those elements in the set statement
                           traverseAssign( setStatementObj, record.myAirData);
                           break;
                        }
                        case "myZone":
                        {
                           // Add/change myAirData just those elements in the set statement
                           traverseAssign( setStatementObj, record.myAirData);
                           break;
                        }
                        case "countDownToOff":
                        {
                           // Add/change myAirData just those elements in the set statement
                           let currentValue = setStatementObj.aircons[ac].info.countDownToOff;
                           traverseAssign( setStatementObj, record.myAirData);
                           // If contDownToOff is non-zero, countDownTonOn has to be set to zero
                           // also record time the countDownToOff is set
                           if ( currentValue != 0 ) {
                              value="{aircons:{" + ac + ":{info:{countDownToOn:0}}}}";
                              quotedValues=value.replace(/(\{|,)\s*(.+?)\s*:/g, '$1"$2":');
                              setStatementObj = JSON.parse( quotedValues );
                              console.log(`SERVER: setStatementObj.aircons.${ac}.info =`,setStatementObj.aircons[ac].info)
                              traverseAssign( setStatementObj, record.myAirData);
                              // set the time when countdownToOff is set
                              // use the key "unitType" as a proxy for the time "countDownToOn" or "countDownToOff" is set
                              value="{aircons:{" + ac + ":{info:{unitType:" + Date.now() + "}}}}";
                              quotedValues=value.replace(/(\{|,)\s*(.+?)\s*:/g, '$1"$2":');
                              setStatementObj = JSON.parse( quotedValues );
                              traverseAssign( setStatementObj, record.myAirData);
                           } 
                           break;
                        }
                        case "countDownToOn":
                        {
                           // Add/change myAirData just those elements in the set statement
                           let currentValue = setStatementObj.aircons[ac].info.countDownToOn;
                           traverseAssign( setStatementObj, record.myAirData);
                           // If contDownToOn is non-zero, countDownTonOff has to be set to zero
                           // also record time the countDownToOn is set
                           if ( currentValue != 0 ) {
                              value="{aircons:{" + ac + ":{info:{countDownToOff:0}}}}";
                              quotedValues=value.replace(/(\{|,)\s*(.+?)\s*:/g, '$1"$2":');
                              setStatementObj = JSON.parse( quotedValues );
                              console.log(`SERVER: setStatementObj.aircons.${ac}.info =`,setStatementObj.aircons[ac].info)
                              traverseAssign( setStatementObj, record.myAirData);
                              // set the time when countdownToOn is set
                              // use the key "unitType" as a proxy for the time "countDownToOn" or "countDownToOff" is set
                              value="{aircons:{" + ac + ":{info:{unitType:" + Date.now() + "}}}}";
                              quotedValues=value.replace(/(\{|,)\s*(.+?)\s*:/g, '$1"$2":');
                              setStatementObj = JSON.parse( quotedValues );
                              traverseAssign( setStatementObj, record.myAirData);
                           } 
                           break;
                        }
                        default:
                        {
                           console.log( `unhandled setAircon info key: ${key}` );
                           keyMatch = false;
                           keyNotFound = `${key}`;
                           break;
                           // process.exit( 1 );
                        }
                     }
                     if ( keyMatch == false ) 
                     {
                        log(`unhandled setAircon info key: ${ac} info ${key}`)
                     }
                  }
               }
            } else if (setLightInProgress == true )
            {
               // log( `In json before, value: ${value}` );

               // Sets do not have .myLights at the beginning. Add it.
               value="{myLights:{lights:" + value + "}}";

               // Parsing {id:{"6801801", value:0} }
               //The first replace changes the last key/value pair
               //The second replace changes the keys
               exists_state = pstate.test(value);
               if ( exists_state )
               {
                  quotedValues=value.replace(/([a-zA-Z0-9-]+):([a-zA-Z0-9-]+)/g, "$1:\"$2\"")
                                    .replace(/(\{|,)\s*(.+?)\s*:/g, '$1"$2":');
               } else
               {
                  quotedValues=value.replace(/(\{|,)\s*(.+?)\s*:/g, '$1"$2":');
               }
               // log( `In json after, value: ${quotedValues}` );

               // Parse the given jqPath, to a json object
               let setStatementObj = JSON.parse( quotedValues );

               if ( setStatementObj.result == false )
               {
                  res.writeHead( 404, { 'Content-Type': 'text/html' } );
                  log( `SERVER: Cannot Parse ${ value }` );
                  log( `SERVER: end` );
                  return res.end();
               }

               log( `SERVER: Changing record:` );
               // AT THIS POINT WE CAN DO WHAT THE AIRCON WOULD HAVE DONE
               // GIVEN THE "Set" Statement
               // Get the Keys of what is being "Set"
               let newValue="";
               if ( exists_state ) {
                  newValue = setStatementObj.myLights.lights.state;
               } else {
                  newValue = setStatementObj.myLights.lights.value;
               }
               let id = setStatementObj.myLights.lights.id;
               console.log(`SERVER: setStatementObj.myLights.lights =`,setStatementObj.myLights.lights);
               if ( record.myAirData.myLights )
               {
                  if ( record.myAirData.myLights.lights )
                  {
                     if ( record.myAirData.myLights.lights[ id ] )
                     {
                        if ( exists_state )
                        {
                           record.myAirData.myLights.lights[ id ].state = newValue;
                        } else
                        {
                           record.myAirData.myLights.lights[ id ].value = newValue;
                        }
                     } else
                     {
                        console.log( `unhandled setLight id: "${id}"` );
                        keyMatch = false;
                        keyNotFound = `id "${id}"`;
                        // process.exit( 1 );
                     }
                  }
               }
            } else if (setThingInProgress == true )
            {
               // Native v4 sends strict JSON. Preserve the legacy unquoted form too.
               let thing;
               try {
                  thing = JSON.parse(value);
               } catch {
                  thing = JSON.parse(value.replace(/(\{|,)\s*(.+?)\s*:/g, '$1"$2":'));
               }
               let setStatementObj = { myThings: { things: thing } };

               if ( setStatementObj.result == false )
               {
                  res.writeHead( 404, { 'Content-Type': 'text/html' } );
                  log( `SERVER: Cannot Parse ${ value }` );
                  log( `SERVER: end` );
                  return res.end();
               }

               log( `SERVER: Changing record:` );
               // AT THIS POINT WE CAN DO WHAT THE AIRCON WOULD HAVE DONE
               // GIVEN THE "Set" Statement
               // Get the Keys of what is being "Set"
               let newValue = setStatementObj.myThings.things.value;
               let id = setStatementObj.myThings.things.id;
               console.log(`SERVER: setStatementObj.myThings.things =`,setStatementObj.myThings.things);
               if ( record.myAirData.myThings )
               {
                  if ( record.myAirData.myThings.things )
                  {
                     if ( record.myAirData.myThings.things[ id ] )
                     {
                        record.myAirData.myThings.things[ id ].value = newValue;
                     } else
                     {
                        log( `unhandled setThing id: "${id}"` );
                        keyMatch = false;
                        keyNotFound = `id "${id}"`;
                        //process.exit( 1 );
                     }
                  }
               }
            } else
            {
               res.writeHead( 404, { 'Content-Type': 'text/html' } );
               log( `SERVER: Parsing JSON without setAircon, setThing or setLight: ${ key }` );
               log( `SERVER: end` );
               return res.end();
            }


            if ( keyMatch == true )
            {
               log( `SERVER: creating new getSystemData` );
               record.getSystemData = JSON.stringify( record.myAirData );
               log( `SERVER: end` );
               return res.end(`{"ack":true,"request":"${ setKey }"}`);
            } else {
               keyMatch = true;
               return res.end(`{"ack":false,"reason":"${ keyNotFound } not found","request":"${ setKey }"}`);
            } 
         }
         default:
         {
            res.writeHead( 404, { 'Content-Type': 'text/html' } );
            log( `SERVER: UNKNOWN query: ${ key }` );
            log( `SERVER: end` );
            return res.end( `SERVER: UNKNOWN query: ${ key }` );
         }
      }
   }

   if ( ended == false )
      res.end();
   // log ( server_g);
}

Function.prototype.clone = function()
{
    var cloneObj = this;
    if (this.__isClone) {
      cloneObj = this.__clonedFrom;
    }

    var temp = function() { return cloneObj.apply(this,arguments); };
    for(var key in this) {
        temp[key] = this[key];
    }

    temp.__isClone = true;
    temp.__clonedFrom = cloneObj;

    return temp;
}

async function startServer( port, handler, callback )
{
   //let uniqueId = (new Date()).getTime().toString(36);
   //let uniqueId = Date.now().toString(36);

   //let uniqueHandler = uniquId + handler.clone();
   let uniqueHandler = handler.clone();

   // Creating http Server
   //const server = http.createServer( handler );
   const server = http.createServer( uniqueHandler );


   // Kludge to resolve socket open
   server.setMaxListeners(0);

   // The key is to instead listen for the 'error' event to be triggered:
   // listen EADDRINUSE: address already in use :::2025
   try
   {
      await new Promise((resolve, reject) =>
      {
         // Listening to http Server
         listener_g = server.listen( port_g, '127.0.0.1', ( err ) =>
         {
            if ( ! err )
               resolve();
         });
         server.on('connection', (socket) => {
            // Add a newly connected socket
            var socketId = nextSocketId++;
            log( `SERVER.on : connection add socket ${ socketId }` );
            sockets[socketId] = socket;


            socket.on('close', function () {
              // log( `socket.on: close socket: ${ socket} socketId: ${socketId}` );
              log(`socket ${ socketId } closed\n`);
              socket.destroy();
              delete sockets[socketId];

            });
            socket.on('end', function () {
              // log( `socket.on: end socket: ${ socket} socketId: ${socketId}` );
              // log(`socket ${ socketId } end`);
              socket.destroy();
              //delete sockets[socketId];
            });


            server.once('close', ( /* NO PARM */ ) =>
            {
               // Called nCurl times after server.on('close')
               log( `INSIDE SERVERonce: close  socketId: ${ socketId }` );
               // delete sockets(socket);
               // socket.destroy(socket);
            });

         });
         server.once('close', ( /* No PARMS */ ) =>
         {
            // Called nCurl times after server.on('close')
           log( `SERVERonce Outside): close` );
           // delete sockets(socket);
           // socket.destroy(socket);
         });
         server.on('close', ( /* No PARMS */ ) =>
         {
            // happens at very end when server is shutdown
            log( `OUTSIDE SERVER.on: CLOSE` );
         });

         server.once('error', ( err ) =>
         {
            if ( err )
            {
               //log( 'There was an error starting the server in the error listener:', err);
               reject( err );
            }
         });
      });

      // All good
      return callback(null, server);

   } catch ( e )
   {
      // Return to caller any errors
      // log('There was an error starting the server:', e );
      return callback( e, server);
   }
}

// Usage:
// export PORT=2025
// cd test
// node ./AirConServer.js
// In Second Terminal
// cd test
// curl -s -g 'http://localhost:$PORT/?load=testData/dataPassOn1/getSystemData.txt0'
// curl -s -g 'http://localhost:$PORT/?loadFail=testData/dataFailOn5/getSystemData.txt4?loadFailureCound=4'
// ../AdvAir.sh Get Blah Brightness z01 127.0.0.1 TEST_ON
//



module.exports = new Promise((resolve, reject) => startServer( port_g, requestListener, ( e, server ) =>
{
   if ( e )
   {
      //log("StartServer failed. server: %s", server  );
      log(`startServer failed: ${ e }` );
      reject(e);
   } else {
      //log("startServer passed. server: %s", server  );
      log(`Started server. Listening on PORT: ${ port_g }...` );
      server_g = server;
      resolve(server);
   }
}));
