const express = require('express');
const app = express();
const dotenv = require('dotenv').config();

// Body Parser
const bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({ extended: false }));

// ejs
const ejs = require('ejs');
app.set("view engine", "ejs");
app.use(express.static("public"));

// Mail
const mailjet = require('node-mailjet').apiConnect(process.env.API1, process.env.API2);

// Rand Token
const randToken = require("rand-token");

// Models
const user = require("./models/user.js");
const reset = require("./models/reset.js");
const receipe = require("./models/receipe.js");
const ingredient = require("./models/ingredient.js");
const favourite = require ("./models/favourite.js");
const schedule = require ("./models/schedule.js");

// Passport
const session = require("express-session");
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");
app.use(session({
    secret: "mysecret",
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// Flash
const flash = require('connect-flash');
app.use(flash());

app.use(function(req,res,next){
    res.locals.currentUser = req.user;
    res.locals.error = req.flash("error");
    res.locals.success = req.flash("success");
    next();
});

// Mongoose
const mongoose = require('mongoose');
mongoose.connect("mongodb+srv://testWeb:test@cluster0.ggmea.mongodb.net/cooking?retryWrites=true&w=majority&appName=Cluster0");

// Strategy
passport.use(user.createStrategy());
passport.serializeUser(user.serializeUser());
passport.deserializeUser(user.deserializeUser());

const methodOverride = require('method-override');
app.use(methodOverride('_method'));


app.get("/", function(req, res) {
    res.render("index");
});

app.post("/signup", function(req, res) {
    user.register(new user({
        username: req.body.username
    }), req.body.password, function(err, user) {
        if (err) {
            console.log(err);
            res.render("signup");
        } else {
            req.flash("success","tu es bien inscrit");
            passport.authenticate("local")(req, res, function() {
                res.redirect("login");
                
            });
        }
    });
});

app.get("/signup", async function(req, res) {
    res.render("signup");
});

app.get("/login", function(req, res) {
    res.render("login");
});

app.post("/login", async function(req, res) {
    const utilisateur = new user({
        username: req.body.username,
        password: req.body.password
    });
    req.login(utilisateur, function(err) {
        if (err) {
            console.log(err);
        } else {
            passport.authenticate("local")(req, res, function() {
                req.flash("success","super tu es connecte");
                res.redirect("/dashboard");
            });
        }
    });
});

app.get("/dashboard",isLoggedIn, function(req, res) {
    if (!req.isAuthenticated()) {
        req.flash("error", "Vous devez être connecté pour accéder à cette page");
        return res.redirect("/login");
    }
    
    const error = req.flash("error") || null;
    const success = req.flash("success") || null;
    
   
    res.render("dashboard", { 
        error: error, 
        success: success, 
        currentUser: req.user 
    });
});



app.get("/logout", function(req, res, next) {
    req.logout(function(err) {
        if (err) { return next(err); }
        res.redirect("/login");
    });
});

app.get("/forgot", function(req, res) {
    res.render("forgot");
});

app.post("/forgot", async function(req, res) {
    try {
        const userFound = await user.findOne({ username: req.body.username });
        
        if (!userFound) {
            console.log("Utilisateur non trouvé");
            return res.redirect("/forgot");
        }

        const token = randToken.generate(16);
        await reset.create({
            username: userFound.username,
            resetPasswordToken: token,
            resetPasswordExpires: Date.now() + 3600000 // 1 heure
        });

        // Définition des options de l'email
        const request = mailjet
            .post("send", { 'version': 'v3.1' })
            .request({
                Messages: [
                    {
                        From: {
                            Email: "mathis.rambaud@outlook.fr",
                            Name: "AirCorp"
                        },
                        To: [
                            {
                                Email: req.body.username,
                                Name: "Utilisateur"
                            }
                        ],
                        Subject: "Réinitialisation de votre mot de passe",
                        TextPart: `Cliquez sur ce lien pour réinitialiser votre mot de passe : http://localhost:3000/reset/${token}`,
                        HTMLPart: `<strong>Cliquez sur ce lien pour réinitialiser votre mot de passe</strong>: <a href="http://localhost:3000/reset/${token}">Réinitialiser le mot de passe</a>`,
                        CustomID: "AppGettingStartedTest"
                    }
                ]
            });

        // Envoi de l'email via Mailjet
        request
            .then((result) => {
                console.log(result.body);
                res.redirect("/login");
            })
            .catch((err) => {
                console.log(err.statusCode);
                res.redirect("/forgot");
            });

    } catch (err) {
        console.log(err);
        res.redirect("/forgot");
    }
});

app.get("/reset/:token", async function(req, res) {
    try {
        const resetData = await reset.findOne({
            resetPasswordToken: req.params.token,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!resetData) {
            console.log("Token expiré ou invalide");
            return res.redirect("/login");
        }

        res.render("reset", { token: req.params.token });

    } catch (err) {
        console.log(err);
        res.redirect("/login");
    }
});

app.post("/reset/:token", async function(req, res) {
    try {
        const { password } = req.body;
        const token = req.params.token;

        // Trouver le token de réinitialisation dans la base de données
        const resetData = await reset.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!resetData) {
            console.log("Token invalide ou expiré");
            return res.redirect("/login");
        }

        // Trouver l'utilisateur correspondant au token
        const userFound = await user.findOne({ username: resetData.username });

        if (!userFound) {
            console.log("Utilisateur non trouvé");
            return res.redirect("/login");
        }

        // Mettre à jour le mot de passe de l'utilisateur
        await new Promise((resolve, reject) => {
            userFound.setPassword(password, (err) => {
                if (err) {
                    console.log(err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        await userFound.save(); // Utilisation des promesses avec save()

        // Supprimer le token de réinitialisation
        await reset.deleteOne({ _id: resetData._id });

        // Rediriger vers la page de connexion avec un message de succès
        req.flash("success", "Votre mot de passe a été réinitialisé avec succès.");
        res.redirect("/login");

    } catch (err) {
        console.log(err);
        res.redirect("/forgot"); 
    }
});

// reciepe Route 

app.get("/dashboard/myreceipes", isLoggedIn, async function(req, res) {
    try {
        const receipes = await receipe.find({ user: req.user.id });
        res.render("receipe", { receipe: receipes });
    } catch (err) {
        console.log(err);
        res.status(500).send("Erreur serveur");
    }
});
app.get("/dashboard/newreceipe", isLoggedIn, async function(req,res){
    res.render("newreceipe");
});

app.post("/dashboard/newreceipe", async function(req,res){
    try{
        const newReceipe = {
            name: req.body.receipe,
            image: req.body.logo,
            user: req.user.id  
        };
        receipe.create(newReceipe);
        res.redirect("/dashboard/myreceipes");
}catch (err){
    console.log(err);
        res.status(500).send("Erreur serveur");
    }
});

app.delete("/dashboard/myreceipes/:id",isLoggedIn,async function(req,res){
    try{
        const deleteReceipe = await receipe.deleteOne ({_id: req.params.id});
        res.redirect("/dashboard/myreceipes");
    }catch (err){
        console.log(err);
    }
});


app.get("/dashboard/myreceipes/:id", async function(req, res) {
    try {
        const receipes = await receipe.findOne({ _id: req.params.id });

        if (!receipes) {
            return res.status(404).send("Recette non trouvée");
        }

        if (receipes.user.toString() !== req.user.id) {
            return res.status(403).send("Vous n'êtes pas autorisé à accéder à cette recette");
        }

        const ingredients = await ingredient.find({
            user: req.user.id,
            receipe: req.params.id
        });

        res.render("ingredients", { receipe: receipes, ingredients: ingredients });
    } catch (err) {
        console.log(err);
        res.status(500).send("Erreur serveur");
    }
});

app.get("/dashboard/myreceipes/:id/newingredient", async function(req, res) {
    try {
        const foundReceipe = await receipe.findById(req.params.id);
        
        if (!foundReceipe) {
            return res.status(404).send("Recette non trouvée");
        }
        
        res.render("newingredient", { receipe: foundReceipe });
    } catch (err) {
        console.log(err);
        res.status(500).send("Erreur serveur");
    }
});


app.post("/dashboard/myreceipes/:id", async function(req, res) {
    try {
        const newIngredient = {
            name: req.body.name,
            bestDish: req.body.dish,
            user: req.user.id,
            quantity: req.body.quantity,
            receipe: req.params.id
        };

        await ingredient.create(newIngredient); 
        
        res.redirect("/dashboard/myreceipes/" + req.params.id);
    } catch (err) {
        console.log(err);
        res.status(500).send("Erreur serveur");
    }
});

app.delete("/dashboard/myreceipes/:id/:ingredientid", isLoggedIn, async function(req, res){
    try {
        await ingredient.deleteOne({_id: req.params.ingredientid});
        res.redirect("/dashboard/myreceipes/" + req.params.id);
    } catch (err) {
        console.log(err);
        res.redirect("/dashboard/myreceipes/" + req.params.id);
    }
});

app.post("/dashboard/myreceipes/:id/:ingredientid/edit", isLoggedIn, async function(req, res) {
    try {
        const receipeFound = await receipe.findOne({ user: req.user.id, _id: req.params.id });
        if (!receipeFound) {
            return res.status(404).send("Receipe not found");
        }

        const ingredientFound = await ingredient.findOne({
            _id: req.params.ingredientid,
            receipe: req.params.id
        });

        if (!ingredientFound) {
            return res.status(404).send("Ingredient not found");
        }

        res.render("edit", {
            ingredient: ingredientFound,
            receipe: receipeFound
        });
    } catch (err) {
        console.log(err);
        res.status(500).send("Server error");
    }
});

app.put("/dashboard/myreceipes/:id/:ingredientid", isLoggedIn, async function(req, res) {
    const ingredientUpdate = {
        name: req.body.name,
        bestDish: req.body.dish,
        user: req.user.id,
        quantity: req.body.quantity,
        receipe: req.params.id
    };

    try {
        await ingredient.findByIdAndUpdate(req.params.ingredientid, ingredientUpdate);
        res.redirect("/dashboard/myreceipes/" + req.params.id);
    } catch (err) {
        console.log(err);
        res.status(500).send("Server error");
    }
});

//Favourite Routes

app.get("/dashboard/favourites",isLoggedIn, async function(req,res){
   try {
    const favourites = await favourite.find({user:req.user.id});  
       res.render("favourites", {favourite : favourites});
   } catch (err){
       console.log(err);
   }
});
app.get("/dashboard/favourites/newfavourite",isLoggedIn,function(req,res){
    res.render("newfavourite");
});

app.post("/dashboard/favourites",isLoggedIn,async function(req,res){
    try {
        const newFavourite = {
            image : req.body.image,
            title: req.body.title,
            description: req.body.description,
            user : req.user.id
        }; 
       await favourite.create(newFavourite);
        res.redirect("/dashboard/favourites");
    }catch (err){
        console.log(err);
    }
});

app.delete("/dashboard/favourites/:id", isLoggedIn , async function(req,res){
    try{
        await favourite.deleteOne({_id: req.params.id});
        res.redirect("/dashboard/favourites");
    }catch(err){
        console.log(err);
    }
});

//Schedule road

app.get("/dashboard/schedule", isLoggedIn, async function(req,res){
   try{
      const schedules = await schedule.find({user: req.user.id});
      res.render("schedule",{schedule : schedules});
   } catch (err){
    console.log(err);
   }
});

app.get("/dashboard/schedule/newschedule", isLoggedIn, function(req,res){
    res.render("newSchedule");
});

app.post("/dashboard/schedule", isLoggedIn, async function(req,res){
    try{
        const receipeSchedule = {
        receipeName : req.body.receipename,
        scheduleDate : req.body.scheduleDate,
        user: req.user.id,
        time: req.body.time
        };
        await schedule.create(receipeSchedule);
        res.redirect("/dashboard/schedule");
    }catch(err){
        console.log(err);
    }
});

app.delete("/dashboard/schedule/:id", isLoggedIn, async function(req,res){
   try{
       await schedule.deleteOne({_id: req.params.id});
       res.redirect("/dashboard/schedule");
   }catch(err){
       console.log(err);
   }
});

//about

app.get("/about", isLoggedIn, function(req,res){
   res.render("About"); 
});

//function de connection 
function isLoggedIn(req,res,next){
    if(req.isAuthenticated()){
        return next();
    }else{
        req.flash("error","please login again");
        res.redirect("/login");
    }
}



app.listen(3000, function() {
    console.log("Tout est ok");
});
