if ( window != top ) {
	// console.log('not parent window');
} else {
	
	var userOptions;

	function getIframe() { return document.getElementById('CS_sbIframe') }
	function getOpeningTab() { return document.getElementById('CS_sbOpeningTab') }
	
	browser.runtime.sendMessage({action: "getUserOptions"}).then((message) => {
		userOptions = message.userOptions || {};

		if ( userOptions.sideBar.widget.enabled )	
			makeOpeningTab();

		if ( userOptions.sideBar.startOpen )
			openSideBar();

		window.addEventListener('message', (e) => {
			
			switch ( e.data.action ) {
				case "closeSideBar":
					closeSideBar();
					return;
					break;
					
				case "resizeSideBarIframe":

					let url = new URL(browser.runtime.getURL(''));

					if ( e.origin !== url.origin ) return;
					
					if ( !e.data.size ) return;

					let iframe = getIframe();
					if ( !iframe ) return;

					if ( !userOptions.enableAnimations ) 
						iframe.style.setProperty('--user-transition', 'none');

					if ( iframe.resizeWidget && e.data.tileSize) {
						iframe.resizeWidget.options.tileSize = {
							width: e.data.tileSize.width,
							height: e.data.tileSize.height
						};
						
						iframe.resizeWidget.options.allowHorizontal = !e.data.singleColumn;
					}

					if ( e.data.size.height && !iframe.resizeWidget.options.isResizing) {

						if ( iframe.docking.options.windowType === 'undocked' )
							iframe.style.height = Math.min(e.data.size.height, window.innerHeight * window.devicePixelRatio) + "px";
						else
							iframe.style.height = window.innerHeight * window.devicePixelRatio + 'px';
					}

					if ( e.data.size.width && !iframe.resizeWidget.options.isResizing ) {						
						iframe.style.width = e.data.size.width + "px";
					}

					runAtTransitionEnd(iframe, ["width", "height", "top", "bottom", "left", "right"], () => {

						if ( iframe.docking.options.windowType === 'undocked' )
						;//	repositionOffscreenElement(iframe);
						
						if ( iframe.docking.options.windowType === 'docked' )
							iframe.docking.offset();
						
						if ( iframe.resizeWidget )
							iframe.resizeWidget.setPosition();
							
					});
					
					break;
			}
		});
		
	});

	browser.runtime.onMessage.addListener((message, sender, sendResponse) => {

		if (typeof message.userOptions !== 'undefined') {
			userOptions = message.userOptions;
		}
		
		switch ( message.action ) {
			case "closeSideBar":
				closeSideBar();
				break;
				
			case "sideBarHotkey":
				if ( getIframe() )
					closeSideBar();
				else
					openSideBar();
				break;
		}
	});
		
	function openSideBar() {

		let openingTab = getOpeningTab();
		
		if ( openingTab ) openingTab.style.display = 'none';

		let iframe = document.createElement('iframe');
		iframe.id = 'CS_sbIframe';
		iframe.style.opacity = 0;
		iframe.style.width = "0px";
		
		if ( userOptions.searchBarTheme === 'dark' ) 
			iframe.classList.add('CS_dark');

		document.body.appendChild(iframe);

		function saveSideBarOptions(o) {
			userOptions.sideBar.offsets = o.lastOffsets;

			if ( iframe.dataset.opened === "true" ) {
				userOptions.sideBar.position = o.dockedPosition;
				userOptions.sideBar.windowType = o.windowType;
			}

			browser.runtime.sendMessage({action: "saveUserOptions", userOptions:userOptions});
		}

		iframe.onload = function() {

			makeDockable(iframe, {
				windowType: "undocked",
				dockedPosition: userOptions.sideBar.position,
				handleElement: iframe,
				lastOffsets: userOptions.sideBar.offsets,
				onUndock: (o) => {

					iframe.style.height = Math.min( iframe.getBoundingClientRect().height * window.devicePixelRatio, userOptions.sideBar.height ) + "px";

					saveSideBarOptions(o);
					
					runAtTransitionEnd(iframe, ["height"], () => {
						iframe.contentWindow.postMessage({action: "sideBarResize", iframeHeight: userOptions.sideBar.height, docked: false, suggestionsResize: true }, browser.runtime.getURL('/searchbar.html'));	

						// trigger transition event to reset resize widget
						if ( iframe.resizeWidget ) iframe.resizeWidget.setPosition();
						
						repositionOffscreenElement(iframe);
						
						if ( openingTab ) {
							openingTab.docking.options.lastOffsets = iframe.docking.options.lastOffsets;
							["left", "right","top","bottom"].forEach( side => openingTab.style[side] = iframe.style[side] );
						}
					});
				},
				onDock: (o) => {

					iframe.style.height = window.innerHeight * window.devicePixelRatio + 'px';

					saveSideBarOptions(o);

					runAtTransitionEnd(iframe, ["height"], () => {
						iframe.contentWindow.postMessage({action: "sideBarResize", iframeHeight: window.innerHeight * window.devicePixelRatio, docked: true}, browser.runtime.getURL('/searchbar.html'));
					});

				}
			});

			// set the initial state of the sidebar, not the opening tab
			iframe.docking.options.windowType = iframe.dataset.windowtype = userOptions.sideBar.windowType;

			iframe.docking.init();

			runAtTransitionEnd(iframe, ["height", "width"], () => { 

				iframe.style.opacity = 1;
				iframe.dataset.opened = true;
				
				// add resize widget	
				let resizeWidget = addResizeWidget(iframe, {
					tileSize: {width:32, height:32}, // snap size - should update on resizeSidebar message
					columns: userOptions.sideBar.columns,
					rows: 100, // arbitrary init value
					allowHorizontal: true,
					allowVertical: true,
					onDrag: (o) => {
						
						// set the fixed quadrant to top-left
						iframe.docking.translatePosition("top", "left");
						
						// step the container and iframe size
						iframe.style.height = ( o.endCoords.y - iframe.getBoundingClientRect().y ) * window.devicePixelRatio + "px";
						
						// value set on resizeSideBar message based on singleColumn
						if ( resizeWidget.options.allowHorizontal )
							iframe.style.width = ( o.columns * resizeWidget.options.tileSize.width ) + "px";

						// rebuild menu with new dimensions
						iframe.contentWindow.postMessage({action: "sideBarRebuild", columns:o.columns, iframeHeight: parseFloat( iframe.style.height )}, browser.runtime.getURL('/searchbar.html'));	

					},
					onDrop: (o) => {
						
						// resize changes the offsets
						iframe.docking.options.lastOffsets = iframe.docking.getOffsets();

						// save prefs
						userOptions.sideBar.height = parseFloat( iframe.style.height );
						
						if ( resizeWidget.options.allowHorizontal )
							userOptions.sideBar.columns = o.columns;

						browser.runtime.sendMessage({action: "saveUserOptions", userOptions: userOptions}).then(() => {

							// reset the fixed quadrant
							iframe.style.transition = 'none';
							let position = iframe.docking.getPositions(iframe.docking.options.lastOffsets);
							iframe.docking.translatePosition(position.v, position.h);
							iframe.style.transition = null;

							iframe.contentWindow.postMessage({action: "sideBarResize", iframeHeight:userOptions.sideBar.height}, browser.runtime.getURL('/searchbar.html'));
							
							iframe.resizeWidget.setPosition();
						});
					}
				});
				
				// unlike the quickmenu, the sizebar should be fixed
				resizeWidget.style.position = 'fixed';
				
				// add listener to remove the widget on close
				document.addEventListener('closesidebar', () => {
					resizeWidget.parentNode.removeChild(resizeWidget);
					delete iframe.resizeWidget;
				}, {once: true});

			});
		
		}
		
		iframe.src = browser.runtime.getURL('/searchbar.html');

	}
	
	function closeSideBar() {
		
		let iframe = getIframe();
		let openingTab = getOpeningTab();

		iframe.style.opacity = null;
		iframe.dataset.opened = false;

		if ( openingTab ) { 
		//	openingTab.docking.undock();	
			openingTab.style.display = null;
		}
		iframe.parentNode.removeChild(iframe);
		delete iframe;

		document.dispatchEvent(new CustomEvent('closesidebar'));

	}
	
	function makeOpeningTab() {

		let openingTab = document.createElement('div');

		openingTab.id = 'CS_sbOpeningTab';
		openingTab.style.setProperty("--opening-icon", 'url(' + browser.runtime.getURL("/icons/search.svg") + ')');
		openingTab.classList.add('CS_handle');
		
		openingTab.addEventListener('click', () => {
			if ( openingTab.moving ) return false;	
			openSideBar();
		});
		
		//open sidebar if dragging text over
		openingTab.addEventListener('dragenter', (e) => {
			openingTab.dispatchEvent(new MouseEvent('click'));
			getIframe().focus();
		});
		
		// prevent docking on double-click
		openingTab.addEventListener('dblclick', (e) => {
			e.preventDefault();
			e.stopImmediatePropagation();
		});
		
		if ( userOptions.searchBarTheme === 'dark' )
			openingTab.classList.add('CS_dark');
		
		document.body.appendChild(openingTab);

		makeDockable(openingTab, {
			windowType: "undocked",
			dockedPosition: userOptions.sideBar.position,
			handleElement: openingTab,
			lastOffsets: userOptions.sideBar.offsets,
			onUndock: (o) => {
				userOptions.sideBar.offsets = o.lastOffsets;
				browser.runtime.sendMessage({action: "saveUserOptions", userOptions:userOptions});
				
				// match sbContainer position with openingTab
				if ( getIframe() ) getIframe().docking.options.lastOffsets = o.lastOffsets;
			}
		});

		openingTab.docking.init();
	}

	// docking event listeners for iframe
	window.addEventListener('message', (e) => {
	
		if ( e.data.target !== "sideBar" ) return;
		
		let x = e.data.e.clientX / window.devicePixelRatio;
		let y = e.data.e.clientY / window.devicePixelRatio;

		switch ( e.data.action ) {
			case "handle_dragstart":
				getIframe().docking.moveStart({clientX:x, clientY:y});
				break;
			
			case "handle_dragend":
				getIframe().docking.moveEnd({clientX:x, clientY:y});
				break;
			
			case "handle_dragmove":
				getIframe().docking.moveListener({clientX:x, clientY:y});
				break;
				
			case "handle_dock":
				getIframe().docking.toggleDock();
				break;
		}
	});

	document.addEventListener("fullscreenchange", (e) => {
		
		let iframe = getIframe();
		let ot = getOpeningTab();
		
		if ( document.fullscreen )	
			[iframe, ot].forEach( el => { if ( el ) el.classList.add('CS_hide');});
		else 		
			[iframe, ot].forEach( el => { if ( el ) el.classList.remove('CS_hide');});
	});
	
	browser.runtime.onMessage.addListener((message, sender, sendResponse) => {

		if (typeof message.action !== 'undefined') {
			switch (message.action) {
				case "updateSearchTerms":
					//console.log(message);
					break;
			}
		}
	});

}
