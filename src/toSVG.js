import { pd } from 'pretty-data'

import BoundingBox from './BoundingBox'
import denormalise from './denormalise'
import entityToPolyline from './entityToPolyline'
import colors from './util/colors'
import logger from './util/logger'

const polylineToPath = (rgb, polyline) => {
  const color24bit = rgb[2] | (rgb[1] << 8) | (rgb[0] << 16)
  let prepad = color24bit.toString(16)
  for (let i = 0, il = 6 - prepad.length; i < il; ++i) {
    prepad = '0' + prepad
  }
  let hex = '#' + prepad

  // SVG is white by default, so make white lines black
  if (hex === '#ffffff') {
    hex = '#000000'
  }

  const d = polyline.reduce(function (acc, point, i) {
    acc += (i === 0) ? 'M' : 'L'
    acc += point[0] + ',' + point[1]
    return acc
  }, '')
  return '<path fill="none" stroke="' + hex + '" stroke-width="0.1%" d="' + d + '"/>'
}

function mtextToText(point, text, options) {
  const { attachmentPoint, horizontalWidth, verticalHeight, nominalTextHeight } = options
  let _point = point

  /*  DXF Attachment point:
      1 = Top left; 2 = Top center; 3 = Top right;
      4 = Middle left; 5 = Middle center; 6 = Middle right;
      7 = Bottom left; 8 = Bottom center; 9 = Bottom right */

  // different x starting point
  let textAnchor = 'start'
  if ([2, 5, 8].includes(attachmentPoint))
      textAnchor = 'middle'
  if ([3, 6, 9].includes(attachmentPoint))
      textAnchor = 'end'

  // when we have a different y starting point we offset by the hight
  if ([7, 8, 9].includes(attachmentPoint))
    _point[1] = _point[1] - (nominalTextHeight || 0)
  if ([4, 5, 6].includes(attachmentPoint)) 
    _point[1] = _point[1] - ((nominalTextHeight || 0) / 2)

  // linebreak = \\P
  const _text = text.split('\\P')
  const fontSize = (_text.length > 1) 
    ? verticalHeight 
      ? verticalHeight/_text.length 
      : 0.5 
    : (nominalTextHeight || 0.5)
  
  // todo
  // Rotate: transform="rotate(${(options.xAxisY === 1) ? 90 : 0}deg)"
  // Vertical Text direction: text-orientation: upright; writing-mode: vertical-rl;

  return `<text 
    x="${_point[0]}" 
    y="${_point[1]}" 
    width="${horizontalWidth}" 
    height="${verticalHeight}" 
    text-anchor="${textAnchor}"
    style="font-size: ${fontSize}px; font-family: ${options.styleName || 'arial'};">
      ${(_text.length > 1)
          ? _text.map(t => `<tspan dx="0" dy="1.2em" style="font-size: ${fontSize}px;">${t}</tspan>`).join('') // FIXME needs to move dx back by -x to 0 of obove text element
          : text
      }
    </text>`
}

/**
 * Convert the interpolate polylines to SVG
 */
export default (parsed) => {
  const entities = denormalise(parsed)
  const polylines = entities.map(e => {
    return entityToPolyline(e)
  })

  // TODO: better combine with polylines to avoid two loops
  const mtexts = entities.filter(e => e.type === 'MTEXT')

  const bbox = new BoundingBox()
  polylines.forEach(polyline => {
    polyline.forEach(point => {
      bbox.expandByPoint(point[0], point[1])
    })
  })

  const paths = []
  polylines.forEach((polyline, i) => {
    const entity = entities[i]
    const layerTable = parsed.tables.layers[entity.layer]
    if (!layerTable) {
      throw new Error('no layer table for layer:' + entity.layer)
    }

    // TODO: not sure if this prioritization is good (entity color first, layer color as fallback)
    let colorNumber = ('colorNumber' in entity) ? entity.colorNumber : layerTable.colorNumber
    let rgb = colors[colorNumber]
    if (rgb === undefined) {
      logger.warn('Color index', colorNumber, 'invalid, defaulting to black')
      rgb = [0, 0, 0]
    }

    const p2 = polyline.map(function (p) {
      return [p[0], -p[1]]
    })
    paths.push(polylineToPath(rgb, p2))
  })

  const texts = []
  mtexts.forEach((mtext, i) => {
    texts.push(mtextToText([mtext.x, (mtext.nominalTextHeight || 0) - mtext.y], mtext.string, mtext))
  })

  let svgString = '<?xml version="1.0"?>'
  svgString += '<svg xmlns="http://www.w3.org/2000/svg"'
  svgString += ' xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1"'
  svgString += ' preserveAspectRatio="xMinYMin meet"'
  svgString += ' viewBox="' +
    (bbox.minX) + ' ' +
    (-bbox.maxY) + ' ' +
    (bbox.width) + ' ' +
    (bbox.height) + '"'
  svgString += ' width="100%" height="100%"><g id="dxf-paths">' + paths.join('') + '</g><g id="dxf-texts">' + texts.join('') + '</g></svg>'
  return pd.xml(svgString)
}
