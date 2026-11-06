// Stage: floor, runway, neon frames streaming toward the player, horizon sun, graffiti tags, stars.
// Everything uses unlit materials and merged geometry to keep draw calls low (~9).
import * as THREE from '../../vendor/three.module.js';
import { COLORS } from '../core/config.js';

function mergeFrames(count, spacing, w, h, thick) {
  // N hollow rectangles made of 4 thin quads each, merged into one BufferGeometry.
  const pos = [];
  const idx = [];
  let v = 0;
  function quad(x0, y0, x1, y1, z) {
    pos.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z);
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    v += 4;
  }
  for (let i = 0; i < count; i++) {
    const z = -i * spacing;
    const hw = w / 2;
    quad(-hw, 0, hw, thick, z);              // bottom (slightly below floor)
    quad(-hw, h - thick, hw, h, z);          // top
    quad(-hw, 0, -hw + thick, h, z);         // left
    quad(hw - thick, 0, hw, h, z);           // right
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class Environment {
  constructor(scene, textures, quality) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.pulse = 0;
    this.time = 0;
    this.speed = 3; // frame travel speed m/s

    scene.background = new THREE.Color(COLORS.fog);
    scene.fog = new THREE.Fog(COLORS.fog, 10, 46);

    // Floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 80),
      new THREE.MeshBasicMaterial({ map: textures.floor, color: 0xffffff })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.01, -30);
    this.group.add(floor);
    this.floorMat = floor.material;
    this.floorTex = textures.floor;

    // Runway
    const runway = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 60),
      new THREE.MeshBasicMaterial({ map: textures.runway })
    );
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(0, 0.0, -28);
    this.group.add(runway);
    this.runwayTex = textures.runway;

    // Neon rails (one merged geometry)
    const railGeo = new THREE.BoxGeometry(0.04, 0.04, 60);
    const railMat = new THREE.MeshBasicMaterial({ color: COLORS.purpleHot });
    this.railMat = railMat;
    const rails = new THREE.InstancedMesh(railGeo, railMat, 2);
    const m = new THREE.Matrix4();
    m.makeTranslation(-1.12, 0.02, -28); rails.setMatrixAt(0, m);
    m.makeTranslation(1.12, 0.02, -28); rails.setMatrixAt(1, m);
    this.group.add(rails);

    // Streaming neon frames
    this.frameSpacing = 6;
    const frames = new THREE.Mesh(
      mergeFrames(9, this.frameSpacing, 9, 6.5, 0.12),
      new THREE.MeshBasicMaterial({ color: COLORS.purple, side: THREE.DoubleSide })
    );
    frames.position.set(0, -0.05, -6);
    this.frames = frames;
    this.frameMat = frames.material;
    this.group.add(frames);

    // Horizon sun
    const sun = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 26),
      new THREE.MeshBasicMaterial({ map: textures.sun, transparent: true, fog: false, depthWrite: false })
    );
    sun.position.set(0, 9, -70);
    sun.renderOrder = -2;
    this.group.add(sun);
    this.sun = sun;

    // Graffiti tags on both sides
    const tagGeo = new THREE.PlaneGeometry(8, 4);
    const tagL = new THREE.Mesh(tagGeo, new THREE.MeshBasicMaterial({ map: textures.tagLeft, transparent: true, depthWrite: false }));
    tagL.position.set(-9, 4.2, -16);
    tagL.rotation.y = 0.75;
    const tagR = new THREE.Mesh(tagGeo, new THREE.MeshBasicMaterial({ map: textures.tagRight, transparent: true, depthWrite: false }));
    tagR.position.set(9, 4.2, -16);
    tagR.rotation.y = -0.75;
    this.group.add(tagL, tagR);
    this.tagMats = [tagL.material, tagR.material];

    // Stars
    this.stars = null;
    this.setQuality(quality);

    this.baseFrame = new THREE.Color(COLORS.purple);
    this.hotFrame = new THREE.Color(0xffffff);
    this.baseRail = new THREE.Color(COLORS.purpleHot);
  }

  setQuality(q) {
    if (this.stars) { this.group.remove(this.stars); this.stars.geometry.dispose(); this.stars = null; }
    if (q.stars > 0) {
      const p = new Float32Array(q.stars * 3);
      for (let i = 0; i < q.stars; i++) {
        const th = Math.random() * Math.PI * 2;
        const ph = Math.random() * Math.PI * 0.45;
        const r = 60;
        p[i * 3] = Math.cos(th) * Math.sin(ph + 0.3) * r;
        p[i * 3 + 1] = Math.cos(ph + 0.3) * r * 0.6 + 4;
        p[i * 3 + 2] = Math.sin(th) * Math.sin(ph + 0.3) * r;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd8b8ff, size: 1.6, sizeAttenuation: false, fog: false }));
      this.group.add(this.stars);
    }
  }

  beat(strength) { this.pulse = Math.min(1.5, this.pulse + strength); }

  update(dt, speedFactor) {
    this.time += dt;
    const sp = this.speed * (speedFactor || 1);
    this.frames.position.z = -6 + ((this.time * sp) % this.frameSpacing);
    this.runwayTex.offset.y = (this.time * sp / 2) % 1;
    this.pulse = Math.max(0, this.pulse - dt * 3.2);
    const p = Math.min(1, this.pulse);
    this.frameMat.color.copy(this.baseFrame).lerp(this.hotFrame, p * 0.55);
    this.railMat.color.copy(this.baseRail).lerp(this.hotFrame, p * 0.6);
    const s = 1 + p * 0.04;
    this.sun.scale.set(s, s, 1);
  }
}
