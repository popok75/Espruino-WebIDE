/*
 * FlashString.js - Flash memory manager for JavaScript strings
 * Thorsten von Eicken 2016
 * MIT License
 *
 * Stores strings indexed by name in flash, one string per flash page. This is targeted at the
 * esp8266 where each flash page is 4KB. This means that each string consumes 4KB and its length
 * is limited to 4KB minus the length of the name minus 4 bytes.
 * Load the FlashString module using `FS=require('FlashString')`, then write a string using
 * `FS.save(name, str)` and restore it using `str = FS.load(name)`. Writing a string with the
 * same name again overwrites the earlier one. To delete a string use `FS.erase(name)` and to
 * delete all use `FS.eraseAll()`.
 * When "restoring" a string the load() function returns a memoryArea, i.e. a string that
 * points directly into the bytes in flash, so only a couple of JSvars are used to hold the
 * name of the javascript string variable. However, if you change the flash location the string
 * will change too...
 * Esp8266 modules with 512KB flash are not currently supported (too little free flash). Esp8266
 * with 1MB flash can store 5 flash strings and esp8266 with more flash can store 9 strings.
 * The primary intended purpose of the FlashString module is to save javascript modules to flash
 * and execute them from flash. For this purpose, use the save() function to write each module
 * indexed by its name to flash. Then at boot time, load all the flash modules using the
 * FlashLoader's loadAll function, which is under 500 bytes in size. The FlashString module
 * itself uses approx 1KB minified but is not needed to load all modules at boot.
 */

var FL = require("Flash");
var FR = FL.getFree()[2]; // 3rd area has biggest chunk under 1MB
var FA = [FL.getFree()[0].addr,FL.getFree()[1].addr]; // use first 2 pages
var FB = FR.addr;         // start of flash save area (0xf7000)
var FS = 0x1000;          // esp8266 flash page size
var FN = 2+FR.length/ FS;  // number of flash pages //
var FO = 0x40200000;      // offset from flash address to its memory-mapped location

//copy string into a Uint8Array rounded up to a multiple of 4 in length
function s2a(str) {
	while (str.length & 3) str += " ";
	return E.toUint8Array(str);
}

//find flash page for a string by name, returns the flash page address.
//If the name is not found and free==1 it returns a free flash page addr, else it returns 0
function findName(name, free) {
//	console.log("looking for ",name, free);
	// iterate through flash pages to see whether there's a match
	var f = 0;
	for (var i=0; i<FN; i++) {
		var addr ;
		if(i<2) addr = FA[i];
		else addr= FB+(i-2)*FS;
		//var addr = FB+i*FS;
		//  console.log("Checking", i, addr.toString(16));
		// read index at start of page with name length and code text length
		var ix = FL.read(4, addr);
		var nameLen = ix[0];
//		var codeLen = ix[1]<<4;
		// see whether page is unused
		//  console.log("ix[3] ",String.fromCharCode(ix[3]) ,'\xA5' );
//		console.log("(ix[3] != '\xA5) : ' ",(String.fromCharCode(ix[3]) !== '\xA5'));
		if (String.fromCharCode(ix[3]) !== '\xA5') {
			//     console.log("  free at", addr.toString(16));
			f = addr;
			continue;
		}
		// see whether the name length differs
		if (nameLen !== name.length) continue;
		// read the name
		var fName = FL.read(nameLen, addr+4);
		if (fName == name) {
			//     console.log("  found at", addr.toString(16));
			return addr;
		}
	}
	return free ? f : 0;
}

//save() writes the text into a flash location tagged with the name. If
//a string of the same name is already stored in flash it gets replaced.
exports.save = function(name, text) {
	// copy the module name into a Uint8Array rounded up to a multiple of 4 in length
	var nameArr = s2a(name), nal = nameArr.length;
	if (nal+((text.length+15)&0xffc0)+4 > FS) throw("too big");
	// iterate through flash pages to see whether there's a match
	var addr = findName(nameArr, 1);
	if (!addr) throw("no space");
//	 console.log("write at", addr.toString(16), text.length);
	// erase page, then write header, then write name
	FL.erasePage(addr);
	FL.write(E.toUint8Array([nal, text.length>>8, text.length % 256, '\xA5']), addr);
	// print("write"+JSON.stringify(E.toUint8Array([nal, text.length>>8, text.length % 256, '\xA5'])));
	FL.write(nameArr, addr+4);
	// write text in small chunks to avoid copying the whole thing
//	console.log("write", (addr+4+nal).toString(16), text.length>>8, text.length % 256);
	for (var i=0; i<text.length; i+=16) {
		var sub = text.substr(i, 16);
		while (sub.length < 16) sub += " ";
		var buf = E.toUint8Array(sub);
	//	if (i+16 >= text.length) 
	//		console.log("wr", (addr+4+nal+i).toString(16), sub);
		FL.write(buf, addr+4+nal+i);
	}
	var ix = FL.read(4, addr);
//	console.log("readback", ix[0], ix[1], ix[2],ix[3]);
	var codeAddr = addr+4+(ix[0]);
	var codeLen  = (ix[1]<<8) + ix[2];
//	console.log("readback3", E.memoryArea(FO+codeAddr, codeLen));

};

//load() retrieves a string by name or null if not found. The retrieved string is kept in
//flash, i.e., it's a string created by E.memoryArea.
exports.load = function(name) {
	// copy the module name into a Uint8Array rounded up to a multiple of 4 in length
	var nameArr = s2a(name);
	// iterate through flash pages to see whether there's a match
	var addr = findName(nameArr, 0);
	if (!addr) return null;
	// read length
	var ix = FL.read(4, addr);
	// address and length of code
	var codeAddr = addr+4+(ix[0]);
	var codeLen  = (ix[1]<<8) + ix[2];
	// return memory area
//	console.log("  memoryArea", codeAddr.toString(16), codeLen);
//	console.log("  ix", ix[0], ix[1], ix[2]);
	return E.memoryArea(FO+codeAddr, codeLen);
};

//erase() erases a string by name. Warning: if any variable points to the string it will be wiped
//out!
exports.erase = function(name) {
	// copy the module name into a Uint8Array rounded up to a multiple of 4 in length
	var nameArr = s2a(name);//, nal = nameArr.length;
	// iterate through flash pages to see whether there's a match
	var addr = findName(nameArr, 0);
	// erase the flash page
	if (addr) FL.erasePage(addr);
};

//eraseAll() erases all strings. Warning: if any variable points to any string it will be wiped
//out!
exports.eraseAll = function() {
	// loop through pages and erase each one
	for (var i=0; i<FN; i++)
		FL.erasePage(FB+i*FS);
};

/*
//iterate through flash pages and load all modules
exports.printList = function() {
  //console.log("Flash content: ");
  var freepages=0;
  for (var i=0; i<FN; i++) { 
    var addr = FB+i*FS;
   // console.log("Checking", i, addr.toString(16));
    // read index at start of page with name length and code text length
    var ix = FL.read(4, addr);
    var nameLen = ix[0];
    var codeAddr = addr+4+nameLen;
    var codeLen = (ix[1]<<8) + ix[2];
    // see whether page is unused
    if (String.fromCharCode(ix[0]) == '\x00' || (String.fromCharCode(ix[1]) == '\x00' && String.fromCharCode(ix[2]) == '\x00') || String.fromCharCode(ix[3]) != '\xA5') {
    //  console.log("  nothing at", addr.toString(16));
      freepages++;
      continue;
    }
    // read the name
    var name = E.toString(FL.read(nameLen, addr+4)).trim();
    // load memory area as module
    console.log(" - name :"+name+", size :"+codeLen+", address :"+codeAddr.toString(16));
  //  console.log("  memoryArea", codeAddr.toString(16), codeLen, name);
   // Modules.addCached(name, E.memoryArea(FO+codeAddr, codeLen));

  }
  console.log("   +"+ freepages+" free pages");

  }*/

exports.list = function() {
	var ret=Array();
	var freepages=0;
//	var t0=Date().getTime();
	for (var i=0; i<FN; i++) {
		var addr ;
		if(i<2) addr = FA[i];
		else addr= FB+(i-2)*FS;
		
//		if(i>8) addr=FB*8*FS;
		//console.log("Checking", i, addr.toString(16));
		// read index at start of page with name length and code text length
	//	if((i%50)==0) console.log("Checking ",i, addr.toString(16),Date().getTime()-t0);
	//	continue;
		var ix = FL.read(4, addr);
		var nameLen = ix[0];
		var codeAddr = addr+4+nameLen;
		var codeLen = (ix[1]<<8) + ix[2];
		// see whether page is unused
		if (String.fromCharCode(ix[0]) == '\x00' || (String.fromCharCode(ix[1]) == '\x00' && String.fromCharCode(ix[2]) == '\x00') || String.fromCharCode(ix[3]) != '\xA5') {
			//console.log("  nothing at", addr.toString(16));
			freepages++;
			continue;
		}
//		console.log("nameLen",nameLen,"addr",addr);
		// read the name
		var name = E.toString(FL.read(nameLen, addr+4)).trim();
		// load memory area as module
//		console.log(" - name :"+name+", size :"+codeLen+", address :"+codeAddr.toString(16));
		ret.push({"name":name,"size":codeLen,"address":codeAddr.toString(16)});
//		  console.log("  memoryArea", codeAddr.toString(16), codeLen, name);
		// Modules.addCached(name, E.memoryArea(FO+codeAddr, codeLen));

	}
//	console.log("   +"+freepages+" free pages");
	
	ret.push({"free":freepages});
	return (JSON.stringify(ret));
	
};


