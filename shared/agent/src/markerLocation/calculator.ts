"use strict";

import { IUniDiff } from "diff";
import { compareTwoStrings, findBestMatch, Rating } from "string-similarity";
import { Logger } from "../logger";
import { Id } from "../managers/entityManager";
import { LocationsById } from "../managers/markerLocationManager";
import { CSLocationMeta, CSMarkerLocation } from "../shared/api.protocol";
import { buildChangeset, Change, Changeset } from "./changeset";

const LINE_SIMILARITY_THRESHOLD = 0.6;
const CHANGE_SIMILARITY_THRESHOLD = 0.5;
const DELETED = -1;

export async function calculateLocations(
	locations: LocationsById,
	diff: IUniDiff
): Promise<LocationsById> {
	const calculation = new Calculation(locations, buildChangeset(diff));
	return calculation.results();
}

export async function calculateLocation(
	location: CSMarkerLocation,
	diff: IUniDiff
): Promise<CSMarkerLocation> {
	const calculated = await calculateLocations(byId(location), diff);
	return calculated[location.id];
}

function byId(location: CSMarkerLocation): LocationsById {
	const id = location.id;
	const locationById: LocationsById = {};
	locationById[id] = location;
	return locationById;
}

function sortNumber(a: number, b: number) {
	return a - b;
}

function sortMatches(a: Match, b: Match) {
	return a.rating.rating - b.rating.rating;
}

interface Match {
	change: Change;
	rating: Rating;
}

class CalculatedLine {
	newLine = 0;
	delContent = "";
	addContent = "";
	change?: Change;
}

class CalculatedLocation {
	public id: string;
	public lineStartOld: number;
	public lineEndOld: number;
	public colStartOld: number;
	public colEndOld: number;
	public lineStartNew = 0;
	public lineEndNew = 0;
	public colStartNew = 0;
	public colEndNew = 0;
	public lineStartOldContent = "";
	public lineEndOldContent = "";
	public lineStartNewContent = "";
	public lineEndNewContent = "";
	public meta: CSLocationMeta = {};
	private lineMap: Map<number, CalculatedLine>;

	constructor(location: CSMarkerLocation, lineMap: Map<number, CalculatedLine>) {
		this.id = location.id;
		this.lineStartOld = location.lineStart;
		this.lineEndOld = location.lineEnd;
		this.colStartOld = location.colStart;
		this.colEndOld = location.colEnd;
		this.lineMap = lineMap;
	}

	public trimLineStartChange() {
		const change = this.lineStartChange();
		this.lineStartNew = change.addStart + change.adds.length;
		this.colStartNew = 1;
		this.meta.startWasDeleted = true;
	}

	public trimLineEndChange() {
		const change = this.lineEndChange();
		this.lineEndNew = change.addStart - 1;
		this.colEndNew = 1;
		this.meta.endWasDeleted = true;
	}

	public trimLineChange() {
		this.trimLineStartChange();
		this.lineEndNew = this.lineStartNew;
		this.colEndNew = 1;
		this.meta.endWasDeleted = true;
		this.meta.entirelyDeleted = true;
	}

	public isLineStartDeleted(): boolean {
		return this.lineStartNew === DELETED;
	}

	public isLineEndDeleted(): boolean {
		return this.lineEndNew === DELETED;
	}

	public isMultiLine(): boolean {
		return this.lineEndOld > 0;
	}

	public isEntirelyDeleted(): boolean {
		if (this.isMultiLine()) {
			return (
				this.isLineStartDeleted() &&
				this.isLineEndDeleted() &&
				this.lineStartChange() === this.lineEndChange()
			);
		} else {
			return this.isLineStartDeleted();
		}
	}

	public lineStartCalc(): CalculatedLine {
		const calculatedLine = this.lineMap.get(this.lineStartOld);
		if (!calculatedLine) {
			throw new Error(`Could not find calculated starting line ${this.lineStartOld}`);
		}
		return calculatedLine;
	}

	public lineEndCalc(): CalculatedLine {
		const calculatedLine = this.lineMap.get(this.lineEndOld);
		if (!calculatedLine) {
			throw new Error(`Could not find calculated ending line ${this.lineEndOld}`);
		}
		return calculatedLine;
	}

	public lineStartChange(): Change {
		const change = this.lineStartCalc().change;
		if (!change) {
			throw new Error("Could not find change for starting line");
		}
		return change;
	}

	public lineEndChange(): Change {
		const change = this.lineEndCalc().change;
		if (!change) {
			throw new Error("Could not find change for ending line");
		}
		return change;
	}

	public lineStartChangeDelContent(): string {
		return this.lineStartChange().dels.join("\n");
	}

	public lineStartCalcDelContent(): string {
		return this.lineStartCalc().delContent;
	}

	public lineEndCalcDelContent(): string {
		return this.lineEndCalc().delContent;
	}

	public markerLocation(): CSMarkerLocation {
		return {
			id: this.id,
			lineStart: this.lineStartNew,
			colStart: this.colStartNew,
			lineEnd: this.lineEndNew,
			colEnd: this.colEndNew,
			meta: this.meta
		};
	}
}

class Calculation {
	private readonly _lines: number[];
	private readonly _locationsStarting = new Map<number, Id[]>();
	private readonly _locationsEnding = new Map<number, Id[]>();
	private readonly _activeLocations = new Set<Id>();
	private readonly _calculatedLines: Map<number, CalculatedLine>;
	private readonly _calculatedLocations: Map<Id, CalculatedLocation>;
	private readonly _changes: Change[];
	private _lineIndex: number;
	private _finalBalance: number;

	constructor(locations: LocationsById, changeset: Changeset) {
		const calculatedLocations = new Map<Id, CalculatedLocation>();
		const linesOfInterest = new Set<number>();
		const calculatedLines = new Map<number, CalculatedLine>();

		for (const id in locations) {
			const location = locations[id];
			calculatedLocations.set(location.id, new CalculatedLocation(location, calculatedLines));
			if (location.lineStart !== DELETED) {
				linesOfInterest.add(location.lineStart);
				let starting = this._locationsStarting.get(location.lineStart);
				if (!starting) {
					starting = [];
					this._locationsStarting.set(location.lineStart, starting);
				}
				starting.push(location.id);
			}
			if (location.lineEnd !== DELETED) {
				linesOfInterest.add(location.lineEnd);
				let ending = this._locationsEnding.get(location.lineEnd);
				if (!ending) {
					ending = [];
					this._locationsEnding.set(location.lineEnd, ending);
				}
				ending.push(location.id);
			}
		}

		const lines = Array.from(linesOfInterest.values()).sort(sortNumber);
		for (const line of lines) {
			calculatedLines.set(line, new CalculatedLine());
		}

		this._lines = lines;
		this._calculatedLines = calculatedLines;
		this._calculatedLocations = calculatedLocations;
		this._changes = changeset.changes;
		this._lineIndex = 0;
		this._finalBalance = 0;
		this.activateLocationsStartingAtCurrentLine();
	}

	public results(): LocationsById {
		for (const change of this._changes) {
			this.applyChange(change);
		}

		this.calculateLinesUntilEnd();
		this.assignNewLines();
		this.calculateMissingLocations();
		this.calculateColumns();

		const result: LocationsById = {};
		for (const calcLoc of this._calculatedLocations.values()) {
			result[calcLoc.id] = calcLoc.markerLocation();
		}
		return result;
	}

	private activateLocationsStartingAtCurrentLine() {
		const line = this.getCurrentLine();
		const locationIds = this._locationsStarting.get(line);
		if (locationIds) {
			for (const id of locationIds) {
				this._activeLocations.add(id);
			}
		}
	}

	private deactivateLocationsEndingAtCurrentLine() {
		const line = this.getCurrentLine();
		const locationIds = this._locationsEnding.get(line);
		if (locationIds) {
			for (const id of locationIds) {
				this._activeLocations.delete(id);
			}
		}
	}

	private getCurrentLine(): number {
		return this._lines[this._lineIndex];
	}

	// @memoize
	private getAddContentFromChanges(): string[] {
		const addContents = [];
		for (const change of this._changes) {
			addContents.push(change.adds.join("\n"));
		}
		return addContents;
	}

	private nextLine() {
		this.deactivateLocationsEndingAtCurrentLine();
		this._lineIndex++;
		this.activateLocationsStartingAtCurrentLine();
	}

	private moveCurrentLineBy(delta: number) {
		const line = this.getCurrentLine();
		const calculatedLine = this.getCalculatedLine(line);
		calculatedLine.newLine = line + delta;
	}

	private getCalculatedLine(line: number) {
		const calculatedLine = this._calculatedLines.get(line);
		if (!calculatedLine) {
			throw new Error(`Could not find calculated line ${line}`);
		}
		return calculatedLine;
	}

	private assignNewLines() {
		for (const location of this._calculatedLocations.values()) {
			if (location.lineStartOld !== DELETED) {
				const startLine = this.getCalculatedLine(location.lineStartOld);
				location.lineStartNew = startLine.newLine;
				location.lineStartOldContent = startLine.delContent;
				location.lineStartNewContent = startLine.addContent;
			}

			if (location.lineEndOld !== DELETED) {
				const endLine = this.getCalculatedLine(location.lineEndOld);
				location.lineEndNew = endLine.newLine;
				location.lineEndOldContent = endLine.delContent;
				location.lineEndNewContent = endLine.addContent;
			}
		}
	}

	private calculateColumns() {
		for (const location of this._calculatedLocations.values()) {
			// when locations are trimmed, colStartNew and/or colEndNew will be already set
			const colStartNew =
				location.colStartNew > 0
					? location.colStartNew
					: calculateColumn(
							location.colStartOld,
							location.lineStartOldContent,
							location.lineStartNewContent
					  );
			const colEndNew =
				location.colEndNew > 0
					? location.colEndNew
					: calculateColumn(
							location.colEndOld,
							location.lineEndOldContent,
							location.lineEndNewContent
					  );

			if (location.lineStartNew === location.lineEndNew && colStartNew > colEndNew) {
				location.colStartNew = 1;
				location.colEndNew = location.lineEndNewContent.length;
			} else {
				location.colStartNew = colStartNew;
				location.colEndNew = colEndNew;
			}
		}
	}

	private applyChange(change: Change) {
		this.calculateLinesUntil(change);
		this.calculateLinesIn(change);
	}

	private calculateLinesUntil(change: Change) {
		const balance = change.addStart - change.delStart;

		let line;
		while ((line = this.getCurrentLine()) && line < change.delStart) {
			this.moveCurrentLineBy(balance);
			this.nextLine();
		}
	}

	private calculateLinesIn(change: Change) {
		this.setContentChangedInActiveLocations();
		const initialBalance = change.addStart - change.delStart;
		const changeLen = change.adds.length - change.dels.length;
		const delEnd = change.delStart + change.dels.length;
		this._finalBalance = initialBalance + changeLen;

		let line;
		while ((line = this.getCurrentLine()) && line < delEnd) {
			const delIndex = line - change.delStart;
			const delContent = change.dels[delIndex];
			const [addIndex, addContent] = bestMatch(delContent, change.adds);
			let newLine = change.addStart + addIndex;
			if (addIndex < 0) {
				newLine = DELETED;
			}

			const calculatedLine = this.getCalculatedLine(line);
			calculatedLine.newLine = newLine;
			calculatedLine.delContent = delContent;
			calculatedLine.addContent = addContent;
			calculatedLine.change = change;

			this.nextLine();
		}
	}

	private calculateLinesUntilEnd() {
		while (this.getCurrentLine()) {
			this.moveCurrentLineBy(this._finalBalance);
			this.nextLine();
		}
	}

	// Iterate over locations that had its starting line(s) and/or ending line(s)
	// deleted. If the location has at least some of its original content preserved,
	// then we simply trim the removed parts. If the location was entirely deleted,
	// then we try to find it by looking at all changes in the file.
	//
	// TODO room for improvement here: we could also look at changes in other files
	// to try to find blocks of code moved across files
	private calculateMissingLocations() {
		for (const location of this._calculatedLocations.values()) {
			if (location.isEntirelyDeleted()) {
				if (!this.findMovedLocation(location)) {
					location.trimLineChange();
				}
			} else if (location.isLineStartDeleted()) {
				location.trimLineStartChange();
			} else if (location.isLineEndDeleted()) {
				location.trimLineEndChange();
			}
		}
	}

	// Try to find a moved location. A location will only be considered moved if:
	//
	// - it is a single-line location, and was deleted in an change
	// - it is a multi-line location, and its entire range was deleted by a single
	//   change - this is important as we don't want to chase around a location if
	//   at least part of its content was preserved
	//
	// 1) we gather the contents of the change that deleted the location
	// 2) we find all changes that added new contents that match the contents
	//    from (1) with a minimum similarity level defined by changeSimilarityThreshold
	// 3) we iterate over the changes from (2), in order of similarity (best matches first)
	// 4) for each change, we look at its added lines and find the lines that best
	//    match the location's original starting and ending (if multi-line) lines
	// 5) if we find such lines and they have a minimum similarity level defined
	//    by LINE_SIMILARITY_THRESHOLD, and they are in order (start < end), then
	//    we say we found the location
	// 6) if we exhaust all changes from (4) without finding lines (5), then we
	//    consider the location as deleted
	private findMovedLocation(location: CalculatedLocation): boolean {
		// if a multi-line location is considered moved, it means that both its
		// lineStartChange and lineEndChange are the same, so we can always get
		// the content from lineStartChange
		const delContent = location.lineStartChangeDelContent();
		const matchingChanges = this.findChangesWithSimilarAddContent(delContent);

		for (const change of matchingChanges) {
			const adds = change.adds;
			const [lineStartIndex, lineStartContent] = bestMatch(
				location.lineStartCalcDelContent(),
				adds
			);

			if (lineStartIndex === DELETED) {
				continue;
			}

			if (location.isMultiLine()) {
				const [lineEndIndex, lineEndContent] = bestMatch(location.lineEndCalcDelContent(), adds);

				if (lineEndIndex === DELETED) {
					continue;
				}

				if (lineStartIndex > lineEndIndex) {
					// TODO room for improvement - check 2nd, 3rd best matches.
					// that would require collecting and ranking candidates from
					// all matching changes before deciding which one is the most
					// similar
					continue;
				}

				location.lineEndNewContent = lineEndContent;
				location.lineEndNew = change.addStart + lineEndIndex;
				location.lineStartNewContent = lineStartContent;
				location.lineStartNew = change.addStart + lineStartIndex;
				return true;
			} else {
				location.lineStartNewContent = location.lineEndNewContent = lineStartContent;
				location.lineStartNew = location.lineEndNew = change.addStart + lineStartIndex;
				return true;
			}
		}
		return false;
	}

	private findChangesWithSimilarAddContent(content: string): Change[] {
		const addContentFromChanges = this.getAddContentFromChanges();
		const ratings = findBestMatch(content, addContentFromChanges).ratings;
		const matches = [];

		for (let i = 0; i < addContentFromChanges.length; i++) {
			const rating = ratings[i];
			if (rating.rating >= CHANGE_SIMILARITY_THRESHOLD) {
				matches.push({
					change: this._changes[i],
					rating: rating
				});
			}
		}

		return matches.sort(sortMatches).map(match => match.change);
	}

	private setContentChangedInActiveLocations() {
		for (const id of this._activeLocations) {
			const calculatedLocation = this._calculatedLocations.get(id);
			if (calculatedLocation) {
				calculatedLocation.meta.contentChanged = true;
			} else {
				Logger.warn(
					`Calculation error: cannot set flag contentsChanged=true in active location ${id} - calculated location object not found`
				);
			}
		}
	}
}

// Recalculates a column number based on the line's old and new contents. In
// order to find the corresponding column (position) in the new content,
// we take into account:
//
// - pre: 3 characters before column oldCol
// - mid: character at column oldCol
// - pos: 3 characters after column oldCol
//
// Since the substring pre+mid+pos may occur more than once in the old line,
// we calculate its specific index, which indicates which occurrence is located
// around oldCol.
//
// Example: "aaaabcdefghbcdefgh"
//           123456789012345678
//
// oldCol: 8  => pre: bcd, mid: e, pos: fgh, specificIndex: 0
// oldCol: 15 => pre: bcd, mid: e, pos: fgh, specificIndex: 1
// oldCol: 1  => pre:    , mid: a, pos: aaa, specificIndex: 0
//
// In possession of pre, mid, pos and specificIndex, we search all occurrences
// of pre+mid+pos in the new line and return the column number associated with
// mid at the specificIndex. In case pre+mid+pos is not found in the new line,
// we remove pre's first character and pos' last character and try again, until
// pre and pos are both empty, at which point we give up and assume the content
// is no longer present in the new line.
//
// Example:
// oldLine: function foo() {
//          1234567890123456
// newLine: function fooRenamed() {
//          12345678901234567890123
// oldCol: 14 => pre: "oo(", mid: ")", pos: " {", specificIndex: 0
//
// 1st attempt: "oo() {" => not found
// 2nd attempt: "o() "   => not found
// 3rd attempt: "()"     => found, with mid ")" at column 21
//
// Therefore, newCol = 20
//
// Example:
// oldLine: return (foo && bar) || (baz && bar)
//          12345678901234567890123456789012345
// newLine: return !(foo && bar) || !(baz && bar)
//          1234567890123456789012345678901234567
// oldCol: 34 => pre: " ba", mid: "r", pos: ")", specificIndex: 1
//
// 1st attempt: " bar)" => found, with mid "r" at columns 19 and 36
//
// Therefore, since specificIndex is 1, newCol = 36
function calculateColumn(oldCol: number, oldContent: string, newContent: string) {
	if (!oldContent || !newContent || oldContent === newContent) {
		return oldCol;
	}

	if (oldCol <= 1) {
		return 1;
	} else if (oldCol > oldContent.length) {
		return newContent.length + 1;
	}

	let pre = oldContent.substring(oldCol - 4, oldCol - 1);
	const mid = oldContent.substring(oldCol - 1, oldCol);
	let pos = oldContent.substring(oldCol, oldCol + 3);
	let i;

	while (true) {
		const str = pre + mid + pos;

		const oldContentPositions = [];
		i = oldContent.indexOf(str);
		while (i > -1) {
			oldContentPositions.push(i + pre.length + 1);
			i = oldContent.indexOf(str, i + 1);
		}

		const specificIndex = oldContentPositions.indexOf(oldCol);

		const newContentPositions = [];
		i = newContent.indexOf(str);
		while (i > -1) {
			newContentPositions.push(i + pre.length + 1);
			i = oldContent.indexOf(str, i + 1);
		}

		const newColumn =
			newContentPositions[specificIndex] || newContentPositions[newContentPositions.length - 1];
		if (newColumn) {
			return newColumn;
		}

		if (!pre.length && !pos.length) {
			break;
		}

		pre = pre.substring(1, pre.length);
		pos = pos.substring(0, pos.length - 1);
	}

	return DELETED;
}

function bestMatch(content: string, candidates: string[]): [number, string] {
	let winner = -1;
	let highScore = 0;

	for (let i = 0; i < candidates.length; i++) {
		const candidate = candidates[i];

		const rating = compareTwoStrings(content, candidate);
		if (rating > highScore) {
			winner = i;
			highScore = rating;
		}
	}

	if (highScore >= LINE_SIMILARITY_THRESHOLD) {
		return [winner, candidates[winner]];
	} else {
		return [-1, ""];
	}
}
