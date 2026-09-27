import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';

const supported = new Set(['glb', 'gltf', 'stl', '3mf']);
const dialog = document.getElementById('spatial-dialog');
const stage = document.getElementById('spatial-stage');
const canvas = document.getElementById('spatial-canvas');
const fileInput = document.getElementById('spatial-file');
const state = document.getElementById('spatial-state');
const selectionLabel = document.getElementById('spatial-selection');
const explodeButton = document.getElementById('spatial-explode');
const resetButton = document.getElementById('spatial-reset');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020a12);
const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000);
camera.position.set(2.6, 1.8, 3.4);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = !reducedMotion.matches;
controls.dampingFactor = 0.08;
controls.addEventListener('change', render);
scene.add(new THREE.HemisphereLight(0x9befff, 0x04131d, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 3);
key.position.set(3, 5, 4);
scene.add(key);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let model, selected, selectedMaterial, selectedEmissive, frame;

function resize() {
  const box = stage.getBoundingClientRect();
  const width = Math.max(1, box.width), height = Math.max(1, box.height);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  render();
}
function render() {
  if (!canvas.isConnected) return;
  renderer.render(scene, camera);
}
function frameModel(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 0.1);
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(radius * 1.8, radius * 1.2, radius * 2.2));
  camera.near = radius / 100;
  camera.far = radius * 100;
  camera.updateProjectionMatrix();
  controls.update();
}
function clearSelection() {
  if (selectedMaterial?.emissive && selectedEmissive != null) selectedMaterial.emissive.setHex(selectedEmissive);
  selected = undefined; selectedMaterial = undefined; selectedEmissive = undefined;
  selectionLabel.textContent = 'No part selected';
}
function select(object) {
  clearSelection();
  selected = object;
  const material = Array.isArray(object.material) ? object.material[0] : object.material;
  if (material?.emissive) {
    selectedMaterial = material;
    selectedEmissive = material.emissive.getHex();
    material.emissive.setHex(0x48dcff);
  }
  selectionLabel.textContent = object.name || 'Selected part';
}
function pick(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(model, true).find(item => item.object.isMesh);
  if (hit) select(hit.object);
}
function removeModel() {
  if (!model) return;
  scene.remove(model);
  model.traverse(item => { item.geometry?.dispose?.(); if (Array.isArray(item.material)) item.material.forEach(value => value.dispose?.()); else item.material?.dispose?.(); });
  model = undefined;
  clearSelection();
}
function fitGeometry(geometry) {
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: 0x73e7ff, metalness: .25, roughness: .42 });
  return new THREE.Mesh(geometry, material);
}
function loadFile(file) {
  const extension = file.name.toLowerCase().split('.').pop();
  if (!supported.has(extension)) throw new Error('Choose a GLB, glTF, STL, or 3MF file.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The model could not be read.'));
    reader.onload = () => {
      try {
        const bytes = reader.result;
        if (extension === 'stl') return resolve(fitGeometry(new STLLoader().parse(bytes)));
        if (extension === '3mf') return resolve(new ThreeMFLoader().parse(bytes));
        if (extension === 'gltf') return new GLTFLoader().parse(bytes, '', value => resolve(value.scene), reject);
        return new GLTFLoader().parse(bytes, '', value => resolve(value.scene), reject);
      } catch (error) { reject(error); }
    };
    reader.readAsArrayBuffer(file);
  });
}
async function openFile(file) {
  state.textContent = 'LOADING';
  try {
    const next = await loadFile(file);
    removeModel();
    model = next;
    model.traverse(item => { if (item.isMesh) item.userData.origin = item.position.clone(); });
    scene.add(model);
    stage.classList.add('has-model');
    explodeButton.disabled = false;
    resetButton.disabled = false;
    frameModel(model);
    state.textContent = 'READY';
  } catch (error) { state.textContent = 'ERROR'; selectionLabel.textContent = error.message || 'Model load failed.'; }
  render();
}
function explode() {
  if (!model) return;
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.traverse(item => {
    if (!item.isMesh) return;
    const direction = item.getWorldPosition(new THREE.Vector3()).sub(center);
    if (direction.lengthSq() < 0.001) direction.set(0, 1, 0);
    item.position.add(direction.normalize().multiplyScalar(box.getSize(new THREE.Vector3()).length() * 0.12));
  });
  render();
}
function reset() {
  if (!model) return;
  model.traverse(item => { if (item.isMesh && item.userData.origin) item.position.copy(item.userData.origin); });
  clearSelection(); frameModel(model); render();
}
export function openSpatialWorkspace() {
  if (!dialog.open) dialog.showModal();
  resize();
}
fileInput?.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) openFile(file); });
explodeButton?.addEventListener('click', explode);
resetButton?.addEventListener('click', reset);
document.getElementById('close-spatial')?.addEventListener('click', () => dialog.close());
canvas?.addEventListener('pointerdown', event => { canvas.setPointerCapture(event.pointerId); pick(event.clientX, event.clientY); });
stage?.addEventListener('dragover', event => event.preventDefault());
stage?.addEventListener('drop', event => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) openFile(file); });
new ResizeObserver(resize).observe(stage);
window.addEventListener('resize', resize);
window.jarvisSpatial = Object.freeze({ open: openSpatialWorkspace, selectAt: pick, moveSelected(delta) { if (selected) { selected.position.add(new THREE.Vector3(delta.x || 0, delta.y || 0, delta.z || 0)); render(); } }, reset });
