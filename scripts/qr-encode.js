/**
 * QR Code encoder — Versions 1-10, Byte mode, ECC levels L/M/Q/H.
 * Produces a 2D boolean matrix (true = dark module).
 */

// Data capacity (byte mode) per version & ECC level
const CAPACITIES = {
  L: [0,17,32,53,78,106,134,154,192,230,271],
  M: [0,14,26,42,62,84,106,122,152,180,213],
  Q: [0,11,20,32,46,60,74,86,108,130,151],
  H: [0, 7,14,24,34,44,58,64, 84,98,119]
};

const VERSION_SIZES = [0,21,25,29,33,37,41,45,49,53,57];

// Total codewords per version
const TOTAL_CODEWORDS = [0,26,44,70,100,134,172,196,242,292,346];

// ECC codewords per block for each version & level
// [numBlocks, eccPerBlock, dataPerBlock] — simplified for versions 1-10
const ECC_TABLE = {
  "1-L":[1,7,19], "1-M":[1,10,16], "1-Q":[1,13,13], "1-H":[1,17,9],
  "2-L":[1,10,34], "2-M":[1,16,28], "2-Q":[1,22,22], "2-H":[1,28,16],
  "3-L":[1,15,55], "3-M":[1,26,44], "3-Q":[2,18,17], "3-H":[2,22,13],
  "4-L":[1,20,80], "4-M":[2,18,32], "4-Q":[2,26,24], "4-H":[4,16,9],
  "5-L":[1,26,108],"5-M":[2,24,43], "5-Q":[2,18,15,2,16],"5-H":[2,22,11,2,12],
  "6-L":[2,18,68], "6-M":[4,16,27], "6-Q":[4,24,19], "6-H":[4,28,15],
  "7-L":[2,20,78], "7-M":[4,18,31], "7-Q":[2,18,14,4,15],"7-H":[4,26,13,1,14],
  "8-L":[2,24,97], "8-M":[2,22,38,2,39],"8-Q":[4,22,18,2,19],"8-H":[4,26,14,2,15],
  "9-L":[2,30,116],"9-M":[3,22,36,2,37],"9-Q":[4,20,16,4,17],"9-H":[4,24,12,4,13],
  "10-L":[2,18,68,2,69],"10-M":[4,26,43,1,44],"10-Q":[6,24,19,2,20],"10-H":[6,28,15,2,16]
};

// Alignment pattern center coordinates per version
const ALIGNMENT = [
  null,null,[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]
];

// Format info bits for each ECC level + mask pattern (pre-computed for mask 0-7)
const FORMAT_BITS = {
  "L-0":0x77c4,"L-1":0x72f3,"L-2":0x7daa,"L-3":0x789d,"L-4":0x662f,"L-5":0x6318,"L-6":0x6c41,"L-7":0x6976,
  "M-0":0x5412,"M-1":0x5125,"M-2":0x5e7c,"M-3":0x5b4b,"M-4":0x45f9,"M-5":0x40ce,"M-6":0x4f97,"M-7":0x4aa0,
  "Q-0":0x355f,"Q-1":0x3068,"Q-2":0x3f31,"Q-3":0x3a06,"Q-4":0x24b4,"Q-5":0x2183,"Q-6":0x2eda,"Q-7":0x2bed,
  "H-0":0x1689,"H-1":0x13be,"H-2":0x1ce7,"H-3":0x19d0,"H-4":0x0762,"H-5":0x0255,"H-6":0x0d0c,"H-7":0x083b
};

// Version info bits (versions 7-10)
const VERSION_INFO = [null,null,null,null,null,null,null,0x07c94,0x085bc,0x09a99,0x0a4d3];

// GF(256) arithmetic for Reed-Solomon
const GF_EXP = new Array(512);
const GF_LOG = new Array(256);
(function initGalois() {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = val;
    GF_LOG[val] = i;
    val <<= 1;
    if (val >= 256) val ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
  GF_LOG[0] = undefined;
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(numEcc) {
  let gen = [1];
  for (let i = 0; i < numEcc; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], GF_EXP[i]);
    }
    gen = next;
  }
  return gen;
}

function rsEncode(data, numEcc) {
  const gen = rsGeneratorPoly(numEcc);
  const result = new Array(numEcc).fill(0);
  for (let i = 0; i < data.length; i++) {
    const coef = data[i] ^ result[0];
    result.shift();
    result.push(0);
    for (let j = 0; j < gen.length - 1; j++) {
      result[j] ^= gfMul(coef, gen[j + 1]);
    }
  }
  return result;
}

function chooseVersion(dataLen, ecc) {
  const cap = CAPACITIES[ecc] || CAPACITIES.M;
  for (let v = 1; v <= 10; v++) {
    if (cap[v] >= dataLen) return v;
  }
  return 10; // clamp to max supported
}

function getEccParams(version, ecc) {
  const key = `${version}-${ecc}`;
  const entry = ECC_TABLE[key];
  if (!entry) return { blocks: [{ count: 1, dataWords: 10, eccWords: 10 }] };
  if (entry.length === 3) {
    return { blocks: [{ count: entry[0], eccWords: entry[1], dataWords: entry[2] }] };
  }
  // Two groups
  return {
    blocks: [
      { count: entry[0], eccWords: entry[1], dataWords: entry[2] },
      { count: entry[3], eccWords: entry[1], dataWords: entry[4] }
    ]
  };
}

function encodeData(text, version, ecc) {
  const totalCodewords = TOTAL_CODEWORDS[version];
  const params = getEccParams(version, ecc);
  let totalData = 0;
  for (const grp of params.blocks) totalData += grp.count * grp.dataWords;

  // Build data bits: mode indicator (0100 = byte) + char count + data
  const bits = [];
  bits.push(0, 1, 0, 0); // byte mode
  const countBits = version <= 9 ? 8 : 16;
  const len = Math.min(text.length, totalData - 2);
  for (let i = countBits - 1; i >= 0; i--) bits.push((len >> i) & 1);
  for (let i = 0; i < len; i++) {
    const code = text.charCodeAt(i) & 0xff;
    for (let b = 7; b >= 0; b--) bits.push((code >> b) & 1);
  }
  // Terminator
  for (let i = 0; i < 4 && bits.length < totalData * 8; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  // Pad codewords
  const padBytes = [0xec, 0x11];
  let pi = 0;
  while (bits.length < totalData * 8) {
    const pb = padBytes[pi % 2];
    for (let b = 7; b >= 0; b--) bits.push((pb >> b) & 1);
    pi++;
  }

  // Convert to bytes
  const dataBytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | (bits[i + b] || 0);
    dataBytes.push(byte);
  }

  // Split into blocks and compute ECC
  const dataBlocks = [];
  const eccBlocks = [];
  let offset = 0;
  for (const grp of params.blocks) {
    for (let b = 0; b < grp.count; b++) {
      const block = dataBytes.slice(offset, offset + grp.dataWords);
      offset += grp.dataWords;
      dataBlocks.push(block);
      eccBlocks.push(rsEncode(block, grp.eccWords));
    }
  }

  // Interleave data
  const interleaved = [];
  const maxDataLen = Math.max(...dataBlocks.map(b => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) interleaved.push(block[i]);
    }
  }
  // Interleave ECC
  const maxEccLen = Math.max(...eccBlocks.map(b => b.length));
  for (let i = 0; i < maxEccLen; i++) {
    for (const block of eccBlocks) {
      if (i < block.length) interleaved.push(block[i]);
    }
  }

  // Convert to bit stream
  const finalBits = [];
  for (const byte of interleaved) {
    for (let b = 7; b >= 0; b--) finalBits.push((byte >> b) & 1);
  }
  // Remainder bits
  const remainderBits = version <= 1 ? 0 : version <= 6 ? 7 : 0;
  for (let i = 0; i < remainderBits; i++) finalBits.push(0);

  return finalBits;
}

function createMatrix(version) {
  const size = VERSION_SIZES[version];
  const modules = Array.from({ length: size }, () => Array(size).fill(0));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));
  return { modules, reserved, size };
}

function addFinderPattern(matrix, row, col) {
  const { modules, reserved, size } = matrix;
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const mr = row + r, mc = col + c;
      if (mr < 0 || mr >= size || mc < 0 || mc >= size) continue;
      const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
      modules[mr][mc] = (inOuter && (inInner || onBorder)) ? 1 : 0;
      reserved[mr][mc] = true;
    }
  }
}

function addAlignmentPattern(matrix, row, col) {
  const { modules, reserved } = matrix;
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const mr = row + r, mc = col + c;
      if (reserved[mr] && reserved[mr][mc]) continue;
      const val = (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)) ? 1 : 0;
      modules[mr][mc] = val;
      reserved[mr][mc] = true;
    }
  }
}

function addTimingPatterns(matrix) {
  const { modules, reserved, size } = matrix;
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) { modules[6][i] = i % 2 === 0 ? 1 : 0; reserved[6][i] = true; }
    if (!reserved[i][6]) { modules[i][6] = i % 2 === 0 ? 1 : 0; reserved[i][6] = true; }
  }
}

function reserveFormatAreas(matrix) {
  const { reserved, size } = matrix;
  // Around top-left finder
  for (let i = 0; i <= 8; i++) { reserved[8][i] = true; reserved[i][8] = true; }
  // Around top-right finder
  for (let i = 0; i <= 7; i++) { reserved[8][size - 1 - i] = true; }
  // Around bottom-left finder
  for (let i = 0; i <= 7; i++) { reserved[size - 1 - i][8] = true; }
  // Dark module
  matrix.modules[size - 8][8] = 1;
  reserved[size - 8][8] = true;
}

function placeDataBits(matrix, dataBits) {
  const { modules, reserved, size } = matrix;
  let bitIdx = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const rows = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);
    for (const row of rows) {
      for (let c = 0; c < 2; c++) {
        const col = right - c;
        if (col < 0 || col >= size) continue;
        if (reserved[row][col]) continue;
        modules[row][col] = bitIdx < dataBits.length ? dataBits[bitIdx] : 0;
        bitIdx++;
      }
    }
    upward = !upward;
  }
}

function applyMask(matrix, maskNum) {
  const { modules, reserved, size } = matrix;
  const maskFns = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
    (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
  ];
  const fn = maskFns[maskNum];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r][c] && fn(r, c)) {
        modules[r][c] ^= 1;
      }
    }
  }
}

function writeFormatInfo(matrix, ecc, maskNum) {
  const { modules, size } = matrix;
  const key = `${ecc}-${maskNum}`;
  const info = FORMAT_BITS[key] || 0;

  for (let i = 0; i < 15; i++) {
    const bit = (info >> (14 - i)) & 1;
    // Horizontal strip near top-left
    if (i < 6) modules[8][i] = bit;
    else if (i === 6) modules[8][7] = bit;
    else if (i === 7) modules[8][8] = bit;
    else if (i === 8) modules[7][8] = bit;
    else modules[14 - i][8] = bit;

    // Second copy
    if (i < 8) modules[size - 1 - i][8] = bit;
    else modules[8][size - 15 + i] = bit;
  }
}

function penaltyScore(matrix) {
  const { modules, size } = matrix;
  let score = 0;
  // Rule 1: runs of same color
  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (modules[r][c] === modules[r][c - 1]) { run++; }
      else { if (run >= 5) score += run - 2; run = 1; }
    }
    if (run >= 5) score += run - 2;
  }
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (modules[r][c] === modules[r - 1][c]) { run++; }
      else { if (run >= 5) score += run - 2; run = 1; }
    }
    if (run >= 5) score += run - 2;
  }
  return score;
}

function encode(text, eccLevel) {
  const ecc = (eccLevel || "M").toUpperCase();
  const version = chooseVersion(text.length, ecc);
  const size = VERSION_SIZES[version];

  const dataBits = encodeData(text, version, ecc);
  let bestMatrix = null;
  let bestScore = Infinity;

  for (let mask = 0; mask < 8; mask++) {
    const m = createMatrix(version);
    addFinderPattern(m, 0, 0);
    addFinderPattern(m, 0, size - 7);
    addFinderPattern(m, size - 7, 0);
    addTimingPatterns(m);

    const align = ALIGNMENT[version];
    if (align && align.length > 1) {
      for (let i = 0; i < align.length; i++) {
        for (let j = 0; j < align.length; j++) {
          // Skip if overlapping finder
          if (i === 0 && j === 0) continue;
          if (i === 0 && j === align.length - 1) continue;
          if (i === align.length - 1 && j === 0) continue;
          addAlignmentPattern(m, align[i], align[j]);
        }
      }
    }

    reserveFormatAreas(m);
    placeDataBits(m, dataBits);
    applyMask(m, mask);
    writeFormatInfo(m, ecc, mask);

    const score = penaltyScore(m);
    if (score < bestScore) {
      bestScore = score;
      bestMatrix = m.modules;
    }
  }

  return bestMatrix;
}

module.exports = { encode, chooseVersion, VERSION_SIZES };
