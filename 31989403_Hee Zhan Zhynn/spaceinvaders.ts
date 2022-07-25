import { concat, fromEvent, interval, merge, Subscription, timer,zip } from 'rxjs'; 
import { map, filter, scan, takeUntil, last } from 'rxjs/operators';


type Key = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'Space' 
type Event = 'keydown' | 'keyup'

function spaceinvaders() {
    // Inside this function you will use the classes and functions 
    // from rx.js
    // to add visuals to the svg element in pong.html, animate them, and make them interactive.
    // Study and complete the tasks in observable exampels first to get ideas.
    // Course Notes showing Asteroids in FRP: https://tgdwyer.github.io/asteroids/ 
    // You will be marked on your functional programming style
    // as well as the functionality that you implement.
    // Document your code!  

    const 
      Constants = {
        CanvasSize: 600,
        BulletExpirationTime: 400,
        BulletRadius: 4,
        BulletVelocity: 5,
        StartInvaderRadius: 10,
        StartShieldLength: 120,
        StartInvaderCount: 9,
        StartInvaderRows: 3,
        StartInvaderColumns: 3,
        StartShieldCount: 3,
        StartTime: 0,
        Translation: 5
      } as const


    // our game has the following view element types:
    type ViewType = 'ship' | 'invaders' | 'bullet' | 'bulletInvader' |'shield'

    // three types of game state transitions
    class Tick { constructor(public readonly elapsed:number) {} }
    class Translate { constructor(public readonly offset:Vec) {} }
    class Shoot { constructor() {} }

    // class RNG {
    //   // LCG using GCC's constants
    //   m = 0x80000000// 2**31
    //   a = 1103515245
    //   c = 12345
    //   state:number
    //   constructor(seed:number) {
    //     this.state = seed ? seed : Math.floor(Math.random() * (this.m - 1));
    //   }
    //   nextInt() {
    //     this.state = (this.a * this.state + this.c) % this.m;
    //     return this.state;
    //   }
    //   nextFloat() {
    //     // returns in range [0,1]
    //     return this.nextInt() / (this.m - 1);
    //   }
    // }

    const 
      gameClock = interval(10)
        .pipe(map(elapsed=>new Tick(elapsed))),

      keyObservable = <T>(e:Event, k:Key, result:()=>T)=>
        fromEvent<KeyboardEvent>(document,e)
          .pipe(
            filter(({code})=>code === k),
            filter(({repeat})=>!repeat),
            map(result)),

      startLeftTranslate = keyObservable('keydown','ArrowLeft',()=>new Translate(new Vec(-Constants.Translation))),
      startRightTranslate  = keyObservable('keydown','ArrowRight',()=>new Translate(new Vec(Constants.Translation))),
      stopLeftTranslate  = keyObservable('keyup','ArrowLeft',()=>new Translate(Vec.Zero)),
      stopRightTranslate  = keyObservable('keyup','ArrowRight',()=>new Translate(Vec.Zero)),
      shoot = keyObservable('keydown','Space', ()=>new Shoot())


    type Circle = Readonly<{pos:Vec, radius:number}>
    type Rectangle = Readonly<{pos:Vec, radius:number}>
    type ObjectId = Readonly<{id:string,createTime:number}>
    interface IBody extends Circle, ObjectId{
      viewType: ViewType,
      vel:Vec,
      translation:Vec,
    }
    
    // Every object that participates in physics is a Body
    type Body = Readonly<IBody>

    // Game state
    type State = Readonly<{
      time:number,
      ship:Body,
      invaders:ReadonlyArray<Body>,
      newInvaders: ReadonlyArray<Body>,
      shields: ReadonlyArray<Body>,
      exit:ReadonlyArray<Body>,
      objCount:number,
      gameOver:boolean,
      bullets: ReadonlyArray<Body>,
      bulletsInvader: ReadonlyArray<Body>,
      shootFrequency: number,
      score: number
    }>

    // Invaders and bullets are both just circles
    const 
      createCircle = (viewType: ViewType)=> (oid:ObjectId)=> (circ:Circle)=> (vel:Vec)=>
        <Body>{
          ...oid,
          ...circ,
          vel:vel,
          translation:Vec.Zero,
          id: viewType+oid.id,
          viewType: viewType
        },

      createInvader = createCircle('invaders'),
      createBullet = createCircle('bullet'),

      createRect = (viewType: ViewType)=> (oid:ObjectId)=> (rect:Rectangle)=> (vel:Vec)=>
        <Body>{
          pos: rect.pos,
          radius: rect.radius,
          vel:vel,
          translation:Vec.Zero,
          id: viewType+oid.id,
          viewType: viewType,
          createTime: oid.createTime
        },

      createShield = createRect('shield');

    function createShip():Body {
      return {
        id: 'ship',
        viewType: 'ship',
        pos: new Vec(Constants.CanvasSize/2,Constants.CanvasSize-60),
        vel: Vec.Zero,
        translation:Vec.Zero,
        radius:5,
        createTime:0
      };
    }

    //create rows of invaders and shield, 
    //createRowsOfInvaders and shields referenced from Learn RxJS (https://www.learnrxjs.io/learn-rxjs/recipes/space-invaders-game)
    const
      startInvaders = () => Array.from(Array(Constants.StartInvaderRows).keys()) //invaders rows 
      .reduce((invds:[], row:number) => [...invds, ...createRowOfInvaders(invds,row)],[]),

      createRowOfInvaders = (indvs:[],row:number) => Array.from(Array(Constants.StartInvaderColumns).keys()) //invaders columns
        .map((i)=>createInvader({id:String(i+ indvs.length),createTime:Constants.StartTime})
        (
        {pos: new Vec(row*80+40, (i)*40+40),
        radius:Constants.StartInvaderRadius})
        (new Vec(0.5, 0))), 
      
      createShields = () => Array.from(Array(Constants.StartShieldCount).keys()) //shield rows
        .reduce((invds:[], row:number) => [...invds, ...createRowOfShields(invds,row)], []),
  
      createRowOfShields= (invds:[], row:number) => Array.from(Array(5).keys()) //shield columns
        .map((i)=> createShield({id:String(i + invds.length),createTime:Constants.StartTime})
        (
        {pos: new Vec(row*200+40, i*5+450 ),
        radius:Constants.StartShieldLength})
        (new Vec(0, 0)));
                

    const
    initialState:State = {
      time:0,
      ship: createShip(),
      invaders: startInvaders(),
      newInvaders: [],
      shields: createShields(),
      exit: [],
      objCount: Constants.StartInvaderCount,
      gameOver: false,
      bullets: [],
      bulletsInvader: [],
      shootFrequency: 169, //interval between shots
      score: 0
    },

    // body doesn't go beyond the canvas size
    noWrap = ({x,y}:Vec) => { 
      const s=Constants.CanvasSize, 
        wrap = (v:number) => v < 0 ? 0 : v > s ? s : v;
      return new Vec(wrap(x),wrap(y))
    },

    // wrap a positions around edges and move 1 level down
    invaderWrap = ({ x, y }: Vec) => {
      const s = Constants.CanvasSize,
      wrap = (v: number) => (v < 0 ? v + s : v > s ? v - s : v),
      lowerDown = (v1: number, v2: number) => (v1 < 0 ? v2 +1 : v1 > s ? v2 + 45  : v2)
      return new Vec(wrap(x), lowerDown(x,y));

    },

    // all non-ship movement comes through here
    moveBody = (o:Body) => 
      <Body>{
        ...o,
        pos:invaderWrap(o.pos.add(o.vel).add(o.translation)),
      },

    // all ship movement comes through here
    moveBodyShip = (o:Body) => 
    <Body>{
      ...o,
      pos:noWrap(o.pos.add(o.translation)),
    },

    // check a State for collisions, invader shots & invaders left :
    //   bullets destroy invaders
    //   bullets destroy ship
    //   bullets destroy shield
    //   ship colliding with invaders ends game
    //   invaders able to shoot
    //   progress to new level when all invaders destroyed
    handleGamePlay = (s: State) => { 
      const 
        bodiesCollided = ([a, b]: [Body, Body]) =>
          a.pos.sub(b.pos).len() <= a.radius + b.radius,

        shieldCollided = ([a, b]: [Body, Body]) => //invaders bullets collided with shield, check if bullets are within range of shield
          ((a.pos.x >= b.pos.x)  && (a.pos.x <=  (b.pos.x + b.radius))) && ( a.pos.y >= b.pos.y) ,

        shipCollided =
          s.invaders.filter(r => bodiesCollided([s.ship, r])).length > 0, //invaders & ship collided

        bulletsCollided =
          s.bulletsInvader.filter(r => bodiesCollided([s.ship, r])).length > 0, //invaders bullets & ship collided

        //Collision between ship bullets and invaders
        allBulletsAndInvaders = flatMap(s.bullets, b => s.invaders.map(r => [b, r])),
        collidedBulletsAndInvaders = allBulletsAndInvaders.filter(bodiesCollided),
        collidedBullets = collidedBulletsAndInvaders.map(([bullet, _]) => bullet),
        collidedInvaders = collidedBulletsAndInvaders.map(([_, invaders]) => invaders),

        //Collision between invaders bullets and shield
        allBulletsInvaderAndShield = flatMap(s.bulletsInvader, b => s.shields.map(r => [b, r])),
        collidedBulletsAndShield = allBulletsInvaderAndShield.filter(shieldCollided),
        collidedBulletsShield = collidedBulletsAndShield.map(([bullet, _]) => bullet),
        collidedShieldInvader = collidedBulletsAndShield.map(([_, shield]) => shield);
        
        // make random invaders shoot
        const
          nextRandom = () =>
          (Math.floor(Math.random() * ((s.invaders.length) /(s.invaders.length*0.8)))), //impure function to select random invaders to shoot

          randomInvaders1 = s.invaders.filter(r => s.time % (s.shootFrequency) === 0),
          randomInvaders = randomInvaders1.filter(nextRandom)          


          // Add shooting elements for the invaders
          const
          addInvaderShoot = (randomInvaders).map((r, i) =>
          createBullet({
            id: String(s.objCount + i),
            createTime: s.time
          })({
            radius: Constants.BulletRadius,
            pos: r.pos
            })(new Vec(0,2))
          ),

          //Reset invaders when game progress to new level
          addNewInvaders = () => s.invaders.length? []: Array.from(Array(Constants.StartInvaderRows).keys()) //invaders row
          .reduce((invds:[], row:number) => [...invds, ...createNewRowOfInvaders(invds,row)], []),

          createNewRowOfInvaders = (invds:[], row:number) => Array.from(Array(Constants.StartInvaderColumns).keys()) //invaders column
          .map((i)=>createInvader({id:String(i + s.time + invds.length),createTime:s.time})
          (
          {pos: new Vec(row*80+40, (i)*40+40),
            radius:Constants.StartInvaderRadius})
            (new Vec(0.5 + Math.floor(s.score/Constants.StartInvaderCount)/50, 0))), //invader moves faster after each level
  
        cut = except((a: Body) => (b: Body) => a.id === b.id);
  
        return <State>{
          ...s,
          bullets: cut(s.bullets)(collidedBullets),
          invaders: cut(s.invaders)(collidedInvaders).concat(addNewInvaders()),
          shields: cut(s.shields)(collidedShieldInvader),
          bulletsInvader: cut(s.bulletsInvader)(collidedBulletsShield).concat(addInvaderShoot),
          score: s.score + (collidedBulletsAndInvaders.length? 10 : 0),
          exit: s.exit.concat(collidedBullets, collidedInvaders, collidedShieldInvader,collidedBulletsShield),
          objCount: s.objCount + s.invaders.length,
          gameOver: (shipCollided || bulletsCollided)
        };
      },

      // interval tick: bodies move, bullets expire
      tick = (s: State, elapsed: number) => {
        const expired = (b: Body) => elapsed - b.createTime > Constants.BulletExpirationTime,
          expiredBullets: Body[] = s.bullets.filter(expired),
          activeBullets = s.bullets.filter(not(expired)),
          expiredBulletsInvaders: Body[] = s.bulletsInvader.filter(expired),
          activeBulletsInvader = s.bulletsInvader.filter(not(expired));

        return handleGamePlay({
          ...s,
          ship: moveBodyShip(s.ship),
          bullets: activeBullets.map(moveBody),
          bulletsInvader: activeBulletsInvader.map(moveBody),
          invaders: s.invaders.map(moveBody),
          exit: s.exit.concat(expiredBullets, expiredBulletsInvaders),
          time: elapsed
        });
      },
        
    // state transducer
    reduceState = (s: State, e:Translate|Tick|Shoot) =>
      e instanceof Translate ? {...s,
        ship: {...s.ship, translation: e.offset}
      }:
      e instanceof Shoot 
        ? {...s, 
        bullets: s.bullets.concat([
          ((unitVec:Vec)=>
          createBullet({id:String(s.objCount),createTime:s.time})
            ({radius:Constants.BulletRadius,pos:s.ship.pos.add(unitVec.scale(s.ship.radius))})
            (s.ship.vel.add(unitVec.scale(Constants.BulletVelocity)
            ))
         )(Vec.unitVecInDirection(0))]),
        objCount: s.objCount + 1}      
      :tick(s,e.elapsed);

    // main game stream
    const subscription =
      merge(gameClock,
        startLeftTranslate,
        startRightTranslate,
        stopLeftTranslate,
        stopRightTranslate,
        shoot)
      .pipe(scan(reduceState,initialState))
      .subscribe(updateView);

  // Update the svg scene.  
  // This is the only impure function in this program
  function updateView(s: State) {
    const 
      svg = document.getElementById("svgCanvas")!,
      ship = document.getElementById("ship")!,

      updateBodyView = (b: Body) => {
        function createBodyView() {
          const v = document.createElementNS(svg.namespaceURI, "ellipse")!;
          attr(v,{id:b.id,rx:b.radius,ry:b.radius});
          v.classList.add(b.viewType)
          svg.appendChild(v)
          return v;
        }
        const v = document.getElementById(b.id) || createBodyView();
        attr(v, { cx: b.pos.x, cy: b.pos.y });
      },

      updateShieldView = (b: Body) => {
        function createBodyView() {
          const v = document.createElementNS(svg.namespaceURI, "rect")!;
          attr(v,{id:b.id, width:b.radius, height:b.radius/10});
          v.classList.add(b.viewType)
          svg.appendChild(v)
          return v;
        }
        const v = document.getElementById(b.id) || createBodyView();
        attr(v, { x: b.pos.x, y: b.pos.y });
      };
      
      // attr(ship, {
      //   transform: `translate(${s.ship.pos.x},${s.ship.pos.y}))`
      // });

      ship.setAttribute("transform", `translate(${s.ship.pos.x},${s.ship.pos.y})`)

      merge(s.bullets, s.bulletsInvader,s.invaders).forEach(updateBodyView)
      s.shields.forEach(updateShieldView);
      s.exit
        .map(o => document.getElementById(o.id))
        .filter(isNotNullOrUndefined)
        .forEach(v => {
          try {
            svg.removeChild(v);
          } catch (e) {
            // rarely it can happen that a bullet can be in exit
            // for both expiring and colliding in the same tick,
            // which will cause this exception
            console.log('Already removed: ' + v.id);
          }
        });

        const g = document.getElementById("score");
        // g.innerHTML = "Score: " + String(s.score)
        g.textContent = "Score: " + String(s.score)

        const l = document.createElementNS(svg.namespaceURI, 'text')!;
        attr(l, {
          x: Constants.CanvasSize /2,
          y: Constants.CanvasSize / 9,
          class: 'gameover'
        });
    
  
        if (s.gameOver) {
          subscription.unsubscribe();
          const v = document.createElementNS(svg.namespaceURI, 'text')!;
          attr(v, {
            x: Constants.CanvasSize / 6,
            y: Constants.CanvasSize / 2,
            class: 'gameover'
          });
          v.textContent = 'Game Over';
          svg.appendChild(v)

          const g = document.createElementNS(svg.namespaceURI, 'text')!;
          attr(g, {
            x: Constants.CanvasSize / 5,
            y: Constants.CanvasSize / 1.8,
            class: 'newGame'
          });
          g.textContent = "press 'spacebar' to restart game";
          svg.appendChild(g)
          
          // To restart game
          const
          restart = keyObservable('keydown','Space', ()=>newGame()),   
          restartGame = restart.subscribe()

          function newGame(){ 
            clearGame()
            svg.removeChild(v)
            svg.removeChild(g)
            spaceinvaders();   
            restartGame.unsubscribe()
          }
        }
        //clear the canvas to prepare for new game
        const 
        clearGame = () =>
          s.exit.concat(s.bulletsInvader,s.bullets, s.invaders)
          .map(o => document.getElementById(o.id))
          .filter(isNotNullOrUndefined)
          .forEach(v => {
            try {
              svg.removeChild(v); 
            } catch (e) {
              // rarely it can happen that a bullet can be in exit
              // for both expiring and colliding in the same tick,
              // which will cause this exception
              console.log('Already removed: ' + v.id);
            }
          });
        
  }

}

  // the following simply runs your pong function on window load.  Make sure to leave it in place.
  if (typeof window != 'undefined')
    window.onload = ()=>{
      spaceinvaders();
    }

  function showKeys() {
    function showKey(k:Key) {
      const arrowKey = document.getElementById(k)!,
        o = (e:Event) => fromEvent<KeyboardEvent>(document,e).pipe(
          filter(({code})=>code === k))
      o('keydown').subscribe(e => arrowKey.classList.add("highlight"))
      o('keyup').subscribe(_=>arrowKey.classList.remove("highlight"))
    }
    showKey('ArrowLeft');
    showKey('ArrowRight');
    // showKey('ArrowUp');
    showKey('Space');
  }
    setTimeout(showKeys, 0)



/////////////////////////////////////////////////////////////////////
// Utility functions

/**
 * A simple immutable vector class
 */
 class Vec {
  constructor(public readonly x: number = 0, public readonly y: number = 0) {}
  add = (b: Vec) => new Vec(this.x + b.x, this.y + b.y);
  sub = (b: Vec) => this.add(b.scale(-1));
  len = () => Math.sqrt(this.x * this.x + this.y * this.y);
  scale = (s: number) => new Vec(this.x * s, this.y * s);
  ortho = () => new Vec(this.y, -this.x);
  rotate = (deg: number) =>
    (rad =>
      ((cos, sin, { x, y }) => new Vec(x * cos - y * sin, x * sin + y * cos))(
        Math.cos(rad),
        Math.sin(rad),
        this
      ))((Math.PI * deg) / 180);

  static unitVecInDirection = (deg: number) => new Vec(0, -1).rotate(deg);
  static Zero = new Vec();
}

/**
 * apply f to every element of a and return the result in a flat array
 * @param a an array
 * @param f a function that produces an array
 */
function flatMap<T, U>(
  a: ReadonlyArray<T>,
  f: (a: T) => ReadonlyArray<U>
): ReadonlyArray<U> {
  return Array.prototype.concat(...a.map(f));
}

const /**
   * Composable not: invert boolean result of given function
   * @param f a function returning boolean
   * @param x the value that will be tested with f
   */
  not = <T>(f: (x: T) => boolean) => (x: T) => !f(x),
  /**
   * is e an element of a using the eq function to test equality?
   * @param eq equality test function for two Ts
   * @param a an array that will be searched
   * @param e an element to search a for
   */
  elem = <T>(eq: (_: T) => (_: T) => boolean) => (a: ReadonlyArray<T>) => (
    e: T
  ) => a.findIndex(eq(e)) >= 0,
  /**
   * array a except anything in b
   * @param eq equality test function for two Ts
   * @param a array to be filtered
   * @param b array of elements to be filtered out of a
   */

  except = <T>(eq: (_: T) => (_: T) => boolean) => (a: ReadonlyArray<T>) => (
    b: ReadonlyArray<T>
  ) => a.filter(not(elem(eq)(b))),
  /**
   * set a number of attributes on an Element at once
   * @param e the Element
   * @param o a property bag
   */

  attr = (e: Element, o: Object) => {
    for (const k in o) e.setAttribute(k, String(o[k]));
  };
/**
 * Type guard for use in filters
 * @param input something that might be null or undefined
 */
function isNotNullOrUndefined<T extends Object>(
  input: null | undefined | T
): input is T {
  return input != null;
}


