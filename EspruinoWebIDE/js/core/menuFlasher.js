/**
 Copyright 2014 Gordon Williams (gw@pur3.co.uk)

 This Source Code is subject to the terms of the Mozilla Public
 License, v2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.

 ------------------------------------------------------------------
  Step by step flasher
 ------------------------------------------------------------------
**/
"use strict";
(function(){

  function init() {
  }

  function showFlasher(urlOrNothing) {
    if (urlOrNothing) urlOrNothing = urlOrNothing.trim();
    if (urlOrNothing=="") urlOrNothing=undefined;

    if (!urlOrNothing) {
      var env = Espruino.Core.Env.getData();
      if (env!==undefined &&
          env.info!==undefined &&
          env.info.binary_url!==undefined) {
        stepSelectBinary(env.BOARD, env.info, env.chip);
        return;
      }
    }

    stepSelectBoard(urlOrNothing);
  }

  function checkBoard(boardId) {
    if (boardId=="PUCKJS") {
      var popup = Espruino.Core.App.openPopup({
        title: "Firmware Update",
        padding: true,
        contents: '<p>Puck.js firmware can\'t be updated from the IDE at the moment.</p>'+
                  '<p>Please see <a href="http://www.espruino.com/Puck.js#firmware-updates" target="_blank">the Puck.js page</a> for more instructions.</p>' ,
        position: "center",
        ok : function() {
          popup.close();
        }
      });
      return false;
    }
    return true;
  }

  function stepSelectBoard( urlOrNothing ) {
    var boardList;

    var popup = Espruino.Core.App.openPopup({
      title: "Firmware Update",
      padding: true,
      contents: '<p>We need to find out which board you have. Please select from the list below and click next...</p>'+
                '<div class="board_list">Loading...</div>'+
                '<p>If you don\'t see your board here, you can\'t update the firmware on it from the IDE. Please click outside this window to close it, and <a href="http://www.espruino.com/Download" target="_blank">see the download page</a> for more instructions.</p>' ,
      position: "center",
      next : function() {
        var boardId = $('.board_list option:selected').attr("name");
        popup.close();
        if (boardId===undefined || boardList[boardId]===undefined)
          console.error("No board ID found! Looks like no option selected");
        else if (checkBoard(boardId)) {
          var boardJson = boardList[boardId]["json"];
          if (urlOrNothing)
            stepReset( { binary_url : urlOrNothing, board_id : boardId, board_chip : boardJson.chip } );
          else
            stepSelectBinary( boardId, boardJson.info, boardJson.chip );
        }
      }
    });

    Espruino.Core.Env.getBoardList(function(data) {
      var html = "<red>Error loading boards...</red>";
      if (data) {
        boardList = data;
        html = "<select>";
        for (var boardId in data) {
          var boardJson = data[boardId]["json"];
          if (boardJson.info.bootloader) {
            //html += '<img src="data:image/png;base64,'+data[boardId]["thumb_b64"]+'" alt="'+boardId+'"/>';
            try {
              html += '  <option name="'+boardId+'">'+boardJson.info.name+'</option>';
            } catch (e) {
              console.warn(e);
            }
          }
        }
        html += "</select>";
      }

      $(".board_list").html(html);
    });

  }

  function stepSelectBinary(boardId, boardInfo, boardChip) {
    var binaries = boardInfo["binaries"];
    var base_url = boardInfo["binary_url"];
    // Old-style, and just one firmware image - go to next!
    if (binaries===undefined) {
      stepReset( { binary_url : base_url, board_id : boardId, board_chip : boardChip } );
      return;
    }
    // New style
    base_url = base_url.substr(0,base_url.lastIndexOf("/")+1);
    // Just one...
    if (binaries.length==1) {
      var binary_url = base_url+binaries[0]["filename"].replace("%v", boardInfo["binary_version"]);
      stepReset( { binary_url : binary_url, board_id : boardId, board_chip : boardChip } );
      return;
    }
    // More than one...
    // Make a list
    var html = "<select class=\"fw_list\">";
    for (var i in binaries) {
      try {
        html += '  <option name="'+i+'" filename="'+binaries[i]["filename"]+'">'+binaries[i]["description"]+'</option>';
      } catch (e) {
        console.warn(e);
      }
    }
    html += "</select>";
    // Create popup
    var popup = Espruino.Core.App.openPopup({
      title: "Firmware Update",
      padding: true,
      contents: '<p>Your board has multiple options for firmware. Please select from the list below and click next...</p>'+
                '<p><b>Note:</b> If you don\'t need any of the features listed, you can choose any firmware.</p>'+
                html,
      position: "center",
      next : function() {
        var binary_filename = $('.fw_list option:selected').attr("filename");
        popup.close();
        if (binary_filename===undefined)
          console.error("No binary filename found! Looks like no option selected");
        else {
          var binary_url = base_url+binary_filename.replace("%v", boardInfo["binary_version"]);
          console.log("Choosing "+binary_url);
          stepReset( { binary_url : binary_url, board_id : boardId, board_chip : boardChip } );
        }
      }
    });

  }


  function stepReset(data) {
    Espruino.Core.MenuPortSelector.disconnect();

    var popup = Espruino.Core.App.openPopup({
      title: "Firmware Update",
      padding: true,
      contents: getDocs(data, "reset"),
      position: "center",
      next : function() {
        popup.close();
        stepFlash(data);
      }
    });
  }

  function stepFlash(data) {
    Espruino.Core.MenuPortSelector.ensureConnected(function() {
      console.log("stepFlash: ",data);
      var url = data.binary_url;
      var flashOffset = data.board_chip.place_text_section;

      var popup = Espruino.Core.App.openPopup({
        title: "Firmware Update",
        padding: true,
        contents: '<p><b>Your firmware is now being updated</b>...</p>'+
                  '<p>See the status bar below to find out what\'s happening...</p>' ,
        position: "center",
      });

      Espruino.Core.Flasher.flashDevice(url, flashOffset, function (err) {
        Espruino.Core.Terminal.grabSerialPort();
        Espruino.Core.MenuPortSelector.disconnect();
        popup.close();
        if (err) {
          Espruino.Core.Notifications.error("Error Flashing: "+ err, true);
          console.log(err);
          stepError(err);
        } else {
          Espruino.Core.Notifications.success("Flashing Complete", true);
          Espruino.callProcessor("flashComplete");
          stepSuccess(data);
        }
      });
    });
  }

  function stepSuccess(data) {
    var popup = Espruino.Core.App.openPopup({
      title: "Firmware Update",
      padding: true,
      contents: '<p><b>The Firmware was updated successfully!</b><p>'+
                getDocs(data, "success"),
      position: "center",
      next : function() {
        popup.close();
      }
    });
  }

  function stepError(err) {
    var popup = Espruino.Core.App.openPopup({
      title: "Firmware Update",
      padding: true,
      contents: '<p><b>Sorry, the firmware update has failed.</b></p>'+
                '<p>The error was: <i>'+err+'</i></p>'+
                '<p>Please try again, or check out the <a href="http://www.espruino.com/Troubleshooting" target="_blank">Troubleshooting page</a> for what to do next.</p>',
      position: "center",
      next : function() {
        popup.close();
      }
    });
  }

  function getDocs(data, doc) {
    var html = undefined;
    if (doc=="reset") {
      if (data.board_id.substr(0,4)=="PICO" ||
          data.board_id=="ESPRUINOWIFI") {
        html =
          '<p><b>Please put your board into bootloader mode.</b> Plug it into USB with the button held down, and then release the button as soon as the LEDs light.</p>'+
          '<p>When the red and green LEDs start pulsing on and off, click \'Next\'...</p>'+
          '<p>If the LEDs are not pulsing, please see the <a href="http://www.espruino.com/Troubleshooting" target="_blank">Troubleshooting page</a></p>';
      } else {
        html =
          '<p><b>Please put your board into bootloader mode.</b> Hold down BTN1, press and release RST, then release BTN1.</p>'+
          '<p>When the blue LED starts pulsing on and off, click \'Next\'...</p>'+
          '<p>If the blue LED is not pulsing, please see the <a href="http://www.espruino.com/Troubleshooting" target="_blank">Troubleshooting page</a></p>';
      }
    } else if (doc=="success") {
      if (data.board_id.substr(0,4)=="PICO"  ||
          data.board_id=="ESPRUINOWIFI") {
        html =
          '<p>Please unplug the board and plug it back in to exit bootloader mode, then click Next to start using it!</p>';
      } else {
        html =
          '<p>Please press the RST button to reset the Espruino out of bootloader mode, then click Next to start using it!</p>';
      }
    }
    if (!html) {
      html = "Couldn't find documentation"
      console.warn("Unknown doc type '"+doc+"' for board '"+data.board_id+"'");
    }
    return html;
  }

  Espruino.Core.MenuFlasher = {
      init : init,
      showFlasher : showFlasher
  };

}());
