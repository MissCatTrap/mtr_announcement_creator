const fs = require('node:fs');
const ffmpegStatic = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const archiver = require('archiver');

const sourceAudioPath = './source_audio';
const sourceAudio = fs.readdirSync(sourceAudioPath);

const configFile = require('./config.json');
const inputFile = require('./input.json');

const outputPath = './output/';
const templatePath = './template_resource_pack/';



async function zipDirectory(sourceDir, outPath) {
	const archive = archiver('zip', { zlib: { level: 9 }});
	const stream = fs.createWriteStream(outPath);
	
	return new Promise((resolve, reject) => {
		archive
			.directory(sourceDir, false)
			.on('error', err => reject(err))
			.pipe(stream)
		;

		stream.on('close', () => resolve());
		archive.finalize();
	});
};



async function bob() {
	if (fs.existsSync(outputPath)) {
		console.log(`Emptying ${outputPath}`);
		await fs.rmSync(outputPath, {recursive: true});
	} else {
		console.log(`Creating ${outputPath}`);
	};
	
	console.log(`Copying template resource pack from ${templatePath} to ${outputPath}`);
	await fs.cpSync(templatePath, outputPath, {recursive: true});
	
	if (inputFile.prefix != 'minecraft') {
		console.log(`Updating prefix from minecraft to ${inputFile.prefix}`);
		await fs.renameSync(`${outputPath}assets/minecraft`, `${outputPath}assets/${inputFile.prefix}`);
	};
	
	if (!inputFile.inputs) {
		inputFile.inputs = [];
	};
	
	if (inputFile.routes) {
		console.log('Generating file lists from routes');
		
		function generateCallingPoints(stops) {
			if (stops.length == 1) {
				if (typeof stops[0] == 'object') stops[0] = stops[0].stop;
				return [ stops[0], 'only' ];
			} else {
				for ([key, value] of Object.entries(stops)) {
					if (typeof value == 'object') stops[key] = stops[key].stop;
				};
				return stops.slice(0, stops.length - 1).concat('and', stops.slice(stops.length - 1));
			};
		};
		
		function stringReplacer(file, route, i) {
			if (file == '!destination' && !route.via) file = route.stops[route.stops.length - 1];
			if (file == '!destination' && route.via) file = [ route.stops[route.stops.length - 1], 'via', route.via ];
			if (file == '!calling_at') file = generateCallingPoints(route.stops.slice(i + 1));
			if (file == 'next_stop' &&  route.stops.slice(i + 1).length <= 1) file = [];
			if (file == '!next_stop' && route.stops.slice(i + 1).length > 1) file = route.stops[i + 1];
			if (file == '!next_stop' &&  route.stops.slice(i + 1).length <= 1) file = [];
			if (file == '!this_stop') file = route.stops[i];
			if (file == '!platform_length_this') file = configFile.stations[route.stops[i]].platform_length;
			if (file == '!platform_length_next') file = configFile.stations[route.stops[i + 1]].platform_length;
			
			return file;
		};
		
		for ([key, route2] of Object.entries(inputFile.routes)) { // runs for every route
			let route = route2;
			let maxRuns = route.stops.length;
			
			for (let i = 0; i < maxRuns; i++) { // runs for every stop
				
				// set via / make strings
				route.via = false;
				
				for (let j = i; j < route.stops.length; j++) {
					console.log(route.stops[j])
					if (typeof route.stops[j] == 'object') {
						if (route.stops[j].via && !route.via) route.via = route.stops[j].via;
						route.stops[j] = route.stops[j].stop;
					};
				};
				
				
				
				// apr
				// skip if first stop
				if (i > 0) {
					// get the correct format
					let format = [];
					if (i + 1 >= maxRuns) { // terminating
						format = configFile.apr_terminus;
					} else { // regular
						format = configFile.apr;
					};
					
					// replace the stuffs
					let files = [];
					for ([pos, file] of Object.entries(format)) {
						files = files.concat(stringReplacer(file, route, i));
					};
					
					// add on short platforms
					if (configFile.stations[route.stops[i]] && configFile.stations[route.stops[i]].platform_length < route.platform_length) {
						for ([pos, file] of Object.entries(configFile.short_platform_this)) {
							files = files.concat(stringReplacer(file, route, i));
						};
					};
					
					// send to the file list
					inputFile.inputs.push( { name: `${route.code}_${route.name}_${route.stops[i]}_apr`, files } );
				};
				
				
				
				// arr
				// skip if first stop
				if (i > 0) {
					// get the correct format
					let format = [];
					if (i + 1 >= maxRuns) { // terminating
						format = configFile.arr_terminus;
					} else { // regular
						format = configFile.arr;
					};
					
					// replace the stuffs
					let files = [];
					for ([pos, file] of Object.entries(format)) {
						files = files.concat(stringReplacer(file, route, i));
					};
					
					// send to the file list
					inputFile.inputs.push( { name: `${route.code}_${route.name}_${route.stops[i]}_arr`, files } );
				};
				
				
				
				// dep
				// skip if last stop
				if (i + 1 < maxRuns) {
					// get the correct format
					let format = configFile.dep;
					
					// replace the stuffs
					let files = [];
					for ([pos, file] of Object.entries(format)) {
						files = files.concat(stringReplacer(file, route, i));
					};
					
					// add on short platforms
					if (configFile.stations[route.stops[i + 1]] && configFile.stations[route.stops[i + 1]].platform_length < route.platform_length) {
						for ([pos, file] of Object.entries(configFile.short_platform_next)) {
							files = files.concat(stringReplacer(file, route, i));
						};
					};
					
					// send to the file list
					inputFile.inputs.push( { name: `${route.code}_${route.name}_${route.stops[i]}_dep`, files } );
				};
			};
		};
	};
	
	let count = 0;
	console.log(`Creating .ogg files and adding entries to sounds.json, ${inputFile.inputs.length} to process`)
	const sounds = JSON.parse(fs.readFileSync(`${outputPath}assets/${inputFile.prefix}/sounds.json`));
	
	for ([key, value] of Object.entries(inputFile.inputs)) {
		sounds[value.name] = {
			'sounds': [
				{
					'name': `${inputFile.prefix}:${value.name}`,
					'stream': true
				}
			]
		};
		
		var command = ffmpeg()
			.audioChannels(1)
			.audioBitrate('128k');
		
		for (let i = 0; i < value.files.length; i++) {
			command.input(`${sourceAudioPath}/${value.files[i]}.ogg`);
		};
		
		await new Promise((resolve, reject) => {
			command
				.on('end', () => {
					count++
					console.log(`${count} / ${inputFile.inputs.length}`)
					resolve();
				})
				.mergeToFile(`${outputPath}assets/${inputFile.prefix}/sounds/${value.name}.ogg`, outputPath);
		});
	};
	fs.writeFileSync(`${outputPath}assets/${inputFile.prefix}/sounds.json`, JSON.stringify(sounds, null, 2), 'utf8');

	console.log(`Zipping resource pack to ./${inputFile.resource_pack_name}.zip`);
	await zipDirectory(outputPath, `./${inputFile.resource_pack_name}.zip`);
	
	console.log(`Cleaning up ${outputPath}`);
	await fs.rmSync(outputPath, {recursive: true});
	
	console.log('Done!');
};

bob()